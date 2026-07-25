/**
 * Apify integration — the ONLY place that knows actor input/output schema
 * (ADR 0005). Multi-portal: PORTAL_CONFIG maps portal keys to their default
 * actor IDs and input builders. LinkedIn uses settings.apify_actor_id so the
 * user can swap between cheap/standard variants from the Settings UI.
 */
import { ApifyClient } from 'apify-client';
import type { EmploymentType, Settings } from './types';
import { getActiveApiCredential, getApiCredentialById } from './credentials';

/**
 * Apify client authed with the active vault token (ADR 0006), falling back to the
 * APIFY_TOKEN env var. Async because resolving the active key reads the DB.
 */
async function client(apiKeyId?: string | null): Promise<{ api: ApifyClient; apiKeyId: string | null }> {
  const credential = apiKeyId
    ? await getApiCredentialById(apiKeyId, 'apify')
    : await getActiveApiCredential('apify');
  if (!credential) {
    throw new Error(
      apiKeyId
        ? 'The Apify key that started this run no longer exists.'
        : 'No Apify token configured. Add one in Settings → API Keys, or set APIFY_TOKEN.',
    );
  }
  return { api: new ApifyClient({ token: credential.value }), apiKeyId: credential.id };
}

// ── Per-portal input builders ─────────────────────────────────────────────

/** Some LinkedIn actors (e.g. cheap_scraper) reject maxItems below this floor. */
const MIN_MAX_ITEMS = 150;

function mapPublishedAt(hours: number): string {
  const seconds = hours * 3600;
  if (seconds <= 0) return '';
  if (seconds <= 86400) return 'r86400'; // Past 24 hours
  if (seconds <= 604800) return 'r604800'; // Past week
  return 'r2592000'; // Past month
}

/**
 * LinkedIn has no "Remote" geo — remote is the f_WT=2 workplace facet on a real
 * location. A saved location like "Remote, US" used to be sent as a literal
 * location string (which LinkedIn can't geocode); it now becomes
 * United States + f_WT=2, i.e. an actual remote-only search (ADR 0058).
 */
export function parseLinkedInLocation(location: string): { location: string; remote: boolean } {
  if (!/\bremote\b/i.test(location)) return { location, remote: false };
  const rest = location.replace(/\bremote\b/gi, '').replace(/^[\s,–-]+|[\s,–-]+$/g, '').trim();
  const norm = rest.replace(/[.\s]/g, '').toLowerCase();
  const geo = !rest || norm === 'us' || norm === 'usa' ? 'United States' : rest;
  return { location: geo, remote: true };
}

/** Valid LinkedIn f_E facet values: 1 Internship … 6 Executive. */
export const LINKEDIN_EXPERIENCE_LEVELS = [
  { value: '1', label: 'Internship' },
  { value: '2', label: 'Entry level' },
  { value: '3', label: 'Associate' },
  { value: '4', label: 'Mid-Senior' },
  { value: '5', label: 'Director' },
  { value: '6', label: 'Executive' },
] as const;

/** f_E digit (the stored settings format) → the actor's native experienceLevel enum. */
const LINKEDIN_EXPERIENCE_ENUM: Record<string, string> = {
  '1': 'internship', '2': 'entry-level', '3': 'associate',
  '4': 'mid-senior', '5': 'director', '6': 'executive',
};

/**
 * Map saved locations to keyword-mode geo strings: remote-ish entries collapse to
 * their real geo ("Remote, US" → "United States"), duplicates are dropped, and an
 * empty list falls back to United States (never search worldwide — unbounded
 * billing). `remoteOnly` is true when EVERY saved location was remote-flagged, so
 * the caller can add the actor's native remote work-type filter; a mixed list gets
 * no filter because a plain geo search already includes its remote rows.
 */
export function linkedInKeywordLocations(locations: string[]): { locations: string[]; remoteOnly: boolean } {
  const geos: string[] = [];
  const seen = new Set<string>();
  let sawOnsite = false;
  let sawRemote = false;
  for (const raw of locations) {
    const loc = raw.trim();
    if (!loc) continue;
    const { location, remote } = parseLinkedInLocation(loc);
    if (remote) sawRemote = true;
    else sawOnsite = true;
    const key = location.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      geos.push(location);
    }
  }
  if (!geos.length) return { locations: ['United States'], remoteOnly: false };
  return { locations: geos, remoteOnly: sawRemote && !sawOnsite };
}

/**
 * Build the LinkedIn actor input. Since cheap_scraper build 0.0.35 (2026-07-19) the
 * actor crawls only the FIRST page of each `startUrls` entry and never paginates a
 * quoted boolean query — the ADR 0058 one-boolean-URL-per-location strategy
 * collapsed from ~500 to ~40 jobs/run. Plain keyword searches still paginate fully
 * ("Fetching N additional page(s)" via the guest API), so BOTH fetch strategies now
 * send keyword-mode input — one search per keyword × location — with the facets the
 * URLs used to carry (f_E/f_JT/f_WT) expressed through the actor's native filter
 * fields, which it applies in-search before billing (ADR 0110).
 *
 * Critically, we never send BOTH startUrls AND keyword/locations — doing so makes
 * the actor double-fetch (its own searches on top of ours) and was the ~1200-job
 * blowup. The hard global `maxItems` cap, dedup, skill-match, and look-back window
 * are unchanged.
 */
function buildLinkedInInput(settings: Settings): Record<string, unknown> {
  const keywords = settings.keywords.filter(Boolean);
  const locations = settings.locations.filter(Boolean);
  const skills = (settings.skills ?? []).filter(Boolean);

  // Total cap = Max jobs/run when set (the hard total limit); otherwise
  // results-per-role × #(role × location) pairs. Always floored to the actor
  // minimum (150).
  let cap = settings.results_per_query * Math.max(1, keywords.length * Math.max(1, locations.length));
  if (settings.max_jobs_per_run > 0) cap = settings.max_jobs_per_run;
  cap = Math.max(cap, MIN_MAX_ITEMS);

  const geo = linkedInKeywordLocations(locations);
  const levels = (settings.linkedin_experience_levels ?? [])
    .map((l) => LINKEDIN_EXPERIENCE_ENUM[l])
    .filter(Boolean);

  const input: Record<string, unknown> = {
    maxItems: cap, // hard global cap on the whole run
    saveOnlyUniqueItems: true,
    // Skill-match (ADR 0018): the actor tags each job with matched/unmatched skills + a 0–100 score.
    resumeKeywords: skills.map((s) => ({ keyword: s })),
    publishedAt: mapPublishedAt(settings.hours_old),
    proxy: { useApifyProxy: true },
    keyword: keywords,
    locations: geo.locations,
    // Full-time + contract only — the scorer flags contract instead of demoting it
    // (ADR 0022); part-time/temp/internship listings are never worth a billed fetch.
    jobType: ['full-time', 'contract'],
  };
  if (levels.length) input.experienceLevel = levels;
  if (geo.remoteOnly) input.workType = ['remote'];
  return input;
}

function buildIndeedInput(settings: Settings): Record<string, unknown> {
  const keywords = settings.keywords.filter(Boolean);
  const locations = settings.locations.filter(Boolean);
  return {
    position: keywords[0] ?? '',
    keyword: keywords[0] ?? '',
    location: locations[0] ?? '',
    countryCode: 'US',
    maxItems: settings.results_per_query,
    datePostedRadius: 1, // Indeed: "last 1 day" (nearest to our hours_old=24 window)
    proxy: { useApifyProxy: true },
  };
}

function buildGlassdoorInput(settings: Settings): Record<string, unknown> {
  const keywords = settings.keywords.filter(Boolean);
  const locations = settings.locations.filter(Boolean);
  return {
    keyword: keywords[0] ?? '',
    position: keywords[0] ?? '',
    location: locations[0] ?? '',
    maxItems: settings.results_per_query,
    proxy: { useApifyProxy: true },
  };
}

// ── Career-sites portal (fantastic.jobs Career Site Job Listing API, ADR 0058) ──
// ATS-direct postings (Greenhouse/Lever/Workday/Ashby/…): no LinkedIn metro-blast
// duplicates, direct application URLs, AI-enriched salary. Pay-per-result $4/1k —
// `career_sites_max_jobs` is the per-run spend dial.

/** Map hours_old to the actor's coarse timeRange buckets. */
function mapTimeRange(hours: number): string {
  if (hours <= 1) return '1h';
  if (hours <= 24) return '24h';
  if (hours <= 168) return '7d';
  return '6m';
}

/** US state abbreviations — the actor wants "City, State, United States" in full. */
const US_STATES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado',
  CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho',
  IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada',
  NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina',
  ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas',
  UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia',
  WI: 'Wisconsin', WY: 'Wyoming', DC: 'District of Columbia',
};

/**
 * Turn the role keywords into the actor's titleSearch terms (title-only OR match):
 *  - "X.js"-style keywords become prefix tokens ("React.js" → "React:*" — titles say
 *    "React Developer", never "React.js Developer")
 *  - Frontend ↔ "Front End" spelling variants are added (titles use both)
 *  - a term containing another term is dropped: in an OR search the shorter one
 *    already matches everything the longer would ("Senior Frontend Developer" ⊇ "Frontend Developer")
 */
export function titleSearchTerms(keywords: string[]): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  const add = (t: string) => {
    const k = t.trim();
    if (k && !seen.has(k.toLowerCase())) { seen.add(k.toLowerCase()); terms.push(k); }
  };
  for (const raw of keywords) {
    const k = raw.trim();
    if (!k) continue;
    const js = k.match(/^([A-Za-z0-9+#]+)\.js$/i);
    if (js) { add(`${js[1]}:*`); continue; }
    if (/front[- ]?end/i.test(k)) {
      add(k.replace(/front[- ]?end/gi, 'Frontend'));
      add(k.replace(/front[- ]?end/gi, 'Front End'));
      continue;
    }
    add(k);
  }
  const stem = (t: string) => t.replace(/:\*$/, '').toLowerCase();
  return terms.filter((t) => !terms.some((o) => o !== t && stem(t) !== stem(o) && stem(t).includes(stem(o))));
}

/**
 * Map the saved locations to the actor's exact-format location search. Remote-ish
 * entries become country-level "United States" (remote rows carry a derived country
 * location); "City, ST" expands the state; a country entry subsumes every metro.
 */
export function careerSiteLocations(locations: string[]): string[] {
  const out: string[] = [];
  for (const raw of locations) {
    const loc = raw.trim();
    if (!loc) continue;
    const norm = loc.replace(/[.\s]/g, '').toLowerCase();
    if (/\bremote\b/i.test(loc) || norm === 'us' || norm === 'usa' || norm === 'unitedstates') {
      out.push('United States');
      continue;
    }
    const m = loc.match(/^(.+),\s*([A-Za-z]{2})$/);
    const state = m ? US_STATES[m[2].toUpperCase()] : undefined;
    out.push(state ? `${m![1].trim()}, ${state}, United States` : loc);
  }
  const unique = [...new Set(out)];
  if (!unique.length) return ['United States']; // never search unfiltered (worldwide = unbounded billing)
  return unique.includes('United States') ? ['United States'] : unique;
}

function buildCareerSitesInput(settings: Settings): Record<string, unknown> {
  return {
    timeRange: mapTimeRange(settings.hours_old),
    // The actor accepts 10–5,000; this cap IS the daily spend at $4/1k jobs.
    limit: Math.min(Math.max(settings.career_sites_max_jobs || 150, 10), 5000),
    titleSearch: titleSearchTerms(settings.keywords.filter(Boolean)),
    locationSearch: careerSiteLocations(settings.locations.filter(Boolean)),
    descriptionType: 'text',
    removeAgency: true, // staffing-agency posts are the bulk of the junk tail
    aiEmploymentTypeFilter: ['FULL_TIME', 'CONTRACTOR'], // scorer flags contract, never demotes it
    // Fill normalized locations for remote rows so locationSearch matches US-remote.
    populateAiRemoteLocation: true,
    populateAiRemoteLocationDerived: true,
    includeCompanyDetails: true, // org_linkedin_size feeds company_size
  };
}

// ── Portal registry ───────────────────────────────────────────────────────

interface PortalConfig {
  /** Default Apify actor ID. LinkedIn overrides this with settings.apify_actor_id. */
  actorId: string;
  buildInput: (s: Settings) => Record<string, unknown>;
}

const PORTAL_CONFIG: Record<string, PortalConfig> = {
  linkedin:     { actorId: 'bebity~linkedin-jobs-scraper',                buildInput: buildLinkedInInput },
  indeed:       { actorId: 'misceres~indeed-scraper',                      buildInput: buildIndeedInput },
  glassdoor:    { actorId: 'bebity~glassdoor-jobs-scraper',               buildInput: buildGlassdoorInput },
  career_sites: { actorId: 'fantastic-jobs~career-site-job-listing-api', buildInput: buildCareerSitesInput },
};

/** Keys of all portals the UI can present. */
export const SUPPORTED_PORTALS = Object.keys(PORTAL_CONFIG);

// ── Public API ────────────────────────────────────────────────────────────

/** @deprecated Kept for tests. Use startAllPortalRuns in production paths. */
export function buildActorInput(settings: Settings): Record<string, unknown> {
  return buildLinkedInInput(settings);
}

export interface StartedRun {
  runId: string;
  defaultDatasetId: string;
  apiKeyId: string | null;
}

/** One actor run to start: which portal/actor + the prepared input. */
export interface RunSpec {
  portal: string;
  actorId: string;
  input: Record<string, unknown>;
}

/**
 * Plan the actor runs for a settings config (ADR 0017). Pure (no network), so it
 * is unit-tested directly. One run **per portal** — LinkedIn searches every role ×
 * location in a single run and de-duplicates (`saveOnlyUniqueItems`), so you pay
 * once per unique job even when locations overlap. LinkedIn uses
 * settings.apify_actor_id (cheap vs. standard variant).
 */
export function planRuns(settings: Settings): RunSpec[] {
  const portals = settings.job_portals?.length ? settings.job_portals : ['linkedin'];
  const specs: RunSpec[] = [];
  for (const portal of portals) {
    const config = PORTAL_CONFIG[portal];
    if (!config) continue;
    const actorId = portal === 'linkedin' ? settings.apify_actor_id : config.actorId;
    specs.push({ portal, actorId, input: config.buildInput(settings) });
  }
  return specs;
}

/** FREE-tier per-job prices (store headlines show the GOLD tier — always the free price here). */
const PORTAL_PRICE_PER_JOB_USD: Record<string, number> = {
  linkedin: 0.0007, // cheap_scraper
  indeed: 0.003,
  glassdoor: 0.003,
  career_sites: 0.012, // fantastic.jobs on free/bronze
};

/**
 * Worst-case cost of one full fetch across the enabled portals (ADR 0059): each
 * run's hard cap × the actor's free-tier per-job price, +30% platform overhead
 * (proxy/compute/queues), floored at $0.75. This is the credit headroom a key must
 * have BEFORE a run starts, so a run never dies mid-scrape on an empty account.
 */
export function estimateRunCostUsd(settings: Settings): number {
  let usd = 0;
  for (const spec of planRuns(settings)) {
    const cap = Number(spec.input.maxItems ?? spec.input.limit ?? 0) || 0;
    usd += cap * (PORTAL_PRICE_PER_JOB_USD[spec.portal] ?? 0.001);
  }
  return Math.max(0.75, Math.round(usd * 1.3 * 100) / 100);
}

/**
 * Start all planned Apify runs in parallel — one per enabled portal. Every webhook
 * URL carries ?portal=<key> so the handler sets source correctly.
 */
export async function startAllPortalRuns(settings: Settings, webhookUrl: string): Promise<StartedRun[]> {
  const specs = planRuns(settings);
  const { api: apify, apiKeyId } = await client();
  const results = await Promise.all(
    specs.map(async (spec): Promise<StartedRun | null> => {
      const run = await apify.actor(spec.actorId).start(spec.input, {
        webhooks: [
          {
            eventTypes: ['ACTOR.RUN.SUCCEEDED', 'ACTOR.RUN.FAILED', 'ACTOR.RUN.TIMED_OUT', 'ACTOR.RUN.ABORTED'],
            requestUrl: `${webhookUrl}&portal=${encodeURIComponent(spec.portal)}`,
          },
        ],
      });
      return { runId: run.id, defaultDatasetId: run.defaultDatasetId, apiKeyId };
    }),
  );
  return results.filter((r): r is StartedRun => r !== null);
}

/** @deprecated Use startAllPortalRuns. Left for tests that import it directly. */
export async function startActorRun(settings: Settings, webhookUrl: string): Promise<StartedRun> {
  const { api, apiKeyId } = await client();
  const run = await api
    .actor(settings.apify_actor_id)
    .start(buildActorInput(settings), {
      webhooks: [
        {
          eventTypes: ['ACTOR.RUN.SUCCEEDED', 'ACTOR.RUN.FAILED', 'ACTOR.RUN.TIMED_OUT', 'ACTOR.RUN.ABORTED'],
          requestUrl: webhookUrl,
        },
      ],
    });
  return { runId: run.id, defaultDatasetId: run.defaultDatasetId, apiKeyId };
}

// ── Dataset helpers ───────────────────────────────────────────────────────

export async function fetchDatasetItems(
  datasetId: string,
  apiKeyId?: string | null,
): Promise<Record<string, unknown>[]> {
  const { api } = await client(apiKeyId);
  const { items } = await api.dataset(datasetId).listItems();
  return items as Record<string, unknown>[];
}

export async function getRunDatasetId(runId: string, apiKeyId?: string | null): Promise<string | null> {
  const { api } = await client(apiKeyId);
  const run = await api.run(runId).get();
  return run?.defaultDatasetId ?? null;
}

// ── Output mapping ────────────────────────────────────────────────────────

function firstString(item: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = item[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (v && typeof v === 'object' && typeof (v as { name?: unknown }).name === 'string') {
      return (v as { name: string }).name;
    }
  }
  return null;
}

function firstBool(item: Record<string, unknown>, keys: string[]): boolean | null {
  for (const k of keys) {
    const v = item[k];
    if (typeof v === 'boolean') return v;
  }
  return null;
}

/** Like firstString but also accepts numbers (employee counts arrive as numbers in some actors). */
function firstSize(item: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = item[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    if (v && typeof v === 'object' && typeof (v as { name?: unknown }).name === 'string') {
      return (v as { name: string }).name;
    }
  }
  return null;
}

/** First finite number among the keys, or null. */
function firstNumber(item: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = item[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return null;
}

/** A string[] from `key` — strings as-is, objects via .keyword/.name. null if the key is absent. */
function stringArray(item: Record<string, unknown>, key: string): string[] | null {
  const v = item[key];
  if (!Array.isArray(v)) return null;
  return v
    .map((x) => {
      if (typeof x === 'string') return x.trim();
      if (x && typeof x === 'object') {
        const o = x as { keyword?: unknown; name?: unknown };
        if (typeof o.keyword === 'string') return o.keyword.trim();
        if (typeof o.name === 'string') return o.name.trim();
      }
      return '';
    })
    .filter(Boolean);
}

/** Normalize actor-specific job-type labels into the database/UI contract. */
export function normalizeEmploymentType(value: string | null): EmploymentType | null {
  const type = (value || '').trim().toLowerCase();
  if (!type) return null;
  if (type.includes('full')) return 'full_time';
  if (type.includes('contract') || type.includes('freelance')) return 'contract';
  if (type.includes('intern')) return 'internship';
  return 'unknown';
}

function actorEasyApply(item: Record<string, unknown>): boolean | null {
  const direct = firstBool(item, ['easyApply', 'isEasyApply', 'easy_apply', 'isEasyApplyJob']);
  if (direct !== null) return direct;
  const type = firstString(item, ['applyType', 'applicationType']);
  if (!type) return null;
  if (/easy[ _-]?apply/i.test(type)) return true;
  if (/external/i.test(type)) return false;
  return null;
}

export interface MappedJob {
  url: string;
  title: string | null;
  company: string | null;
  location: string | null;
  salary: string | null;
  full_description: string | null;
  application_url: string | null;
  easy_apply: boolean | null;
  employment_type: EmploymentType | null;
  /** Company headcount/size text when an actor provides it (often absent in job-search results). */
  company_size: string | null;
  /** Skill-match outputs from the actor's resumeKeywords feature (ADR 0018); null when not provided. */
  skill_match_score: number | null;
  matched_skills: string[] | null;
  unmatched_skills: string[] | null;
  source: string;
}

/**
 * Location for fantastic.jobs items: `locations_derived` is an array (strings, or
 * {city, admin, country} objects); remote rows carry location_type TELECOMMUTE /
 * remote_derived. Falls back to null so the generic key probe takes over.
 */
function derivedLocation(item: Record<string, unknown>): string | null {
  const v = item['locations_derived'];
  if (!Array.isArray(v) || v.length === 0) return null;
  const first = v[0];
  if (typeof first === 'string' && first.trim()) return first.trim();
  if (first && typeof first === 'object') {
    const o = first as Record<string, unknown>;
    const parts = [o.city, o.admin, o.country].filter((x): x is string => typeof x === 'string' && !!x);
    if (parts.length) return parts.join(', ');
  }
  return null;
}

/** "150000–180000 USD / YEAR" from the fantastic.jobs ai_salary_* fields, or null. */
function aiSalary(item: Record<string, unknown>): string | null {
  const min = firstNumber(item, ['ai_salary_min_value', 'ai_salary_minvalue']);
  const max = firstNumber(item, ['ai_salary_max_value', 'ai_salary_maxvalue']);
  const single = firstNumber(item, ['ai_salary_value']);
  const range = min != null && max != null ? `${min}–${max}` : (single ?? min ?? max);
  if (range == null) return null;
  const cur = firstString(item, ['ai_salary_currency']);
  const unit = firstString(item, ['ai_salary_unit_text', 'ai_salary_unittext']);
  return [String(range), cur, unit ? `/ ${unit}` : null].filter(Boolean).join(' ');
}

/** Map one dataset item to a job row. Returns null if it has no usable URL. */
export function mapDatasetItemToJob(item: Record<string, unknown>, source: string): MappedJob | null {
  const url = firstString(item, ['url', 'jobUrl', 'link', 'jobPostingUrl', 'job_url']);
  if (!url) return null;
  const applyUrl = firstString(item, ['applyUrl', 'applicationUrl', 'externalApplyLink', 'companyApplyUrl', 'applyLink']);
  const skillPct = firstNumber(item, ['keywordMatchScorePercentage', 'keywordMatchScore', 'matchScorePercentage']);
  const rawLocation = derivedLocation(item) ?? firstString(item, ['location', 'place', 'jobLocation', 'locations_alt']);
  // Surface remoteness in the location text (dedup canonicals + the UI prefer it).
  const isRemote = firstBool(item, ['remote_derived']) === true || firstString(item, ['location_type']) === 'TELECOMMUTE';
  const location = isRemote ? (rawLocation ? `Remote — ${rawLocation}` : 'Remote') : rawLocation;
  return {
    url,
    title: firstString(item, ['title', 'jobTitle', 'positionName', 'position']),
    company: firstString(item, ['companyName', 'company', 'company_name', 'employer', 'organization']),
    location,
    salary: firstString(item, ['salary', 'salaryInfo', 'compensation', 'salary_raw']) ?? aiSalary(item),
    full_description: firstString(item, [
      'description', 'descriptionText', 'description_text', 'jobDescription', 'fullDescription', 'descriptionHtml', 'description_html',
    ]),
    application_url: applyUrl ?? url,
    easy_apply: actorEasyApply(item),
    employment_type: normalizeEmploymentType(firstString(item, [
      'contractType', 'employmentType', 'employment_type', 'jobType', 'job_type',
    ])),
    company_size: firstSize(item, [
      'companySize', 'companySizeRange', 'employeeCount', 'numEmployees', 'companyEmployeesCount', 'staffCount', 'employees',
      'org_linkedin_size', 'org_linkedin_headcount',
    ]),
    skill_match_score: skillPct == null ? null : Math.max(0, Math.min(100, Math.round(skillPct))),
    matched_skills: stringArray(item, 'matchedKeywords'),
    unmatched_skills: stringArray(item, 'unmatchedKeywords'),
    source,
  };
}
