/**
 * Apify integration — the ONLY place that knows actor input/output schema
 * (ADR 0005). Multi-portal: PORTAL_CONFIG maps portal keys to their default
 * actor IDs and input builders. LinkedIn uses settings.apify_actor_id so the
 * user can swap between cheap/standard variants from the Settings UI.
 */
import { ApifyClient } from 'apify-client';
import type { Settings } from './types';
import { getActiveApiKey } from './credentials';

/**
 * Apify client authed with the active vault token (ADR 0006), falling back to the
 * APIFY_TOKEN env var. Async because resolving the active key reads the DB.
 */
async function client(): Promise<ApifyClient> {
  const token = await getActiveApiKey('apify');
  if (!token) throw new Error('No Apify token configured. Add one in Settings → API Keys, or set APIFY_TOKEN.');
  return new ApifyClient({ token });
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

/** Build a LinkedIn job-search URL for one keyword × location, last-N-hours window. */
export function buildLinkedInSearchUrl(keyword: string, location: string, hoursOld: number): string {
  const params = new URLSearchParams({
    keywords: keyword,
    location: location,
    f_TPR: mapPublishedAt(hoursOld),
  });
  return `https://www.linkedin.com/jobs/search/?${params.toString()}`;
}

/**
 * Build the LinkedIn actor input (ADR 0023). Two selectable fetch strategies, both
 * sharing a HARD global `maxItems` cap, dedup, skill-match, and the look-back window:
 *
 *  - 'url' (default, precise): hand the actor EXACTLY one `startUrls` per role×location
 *    (window baked into the URL's f_TPR). Predictable count; no actor-side expansion.
 *  - 'keyword' (broad): send `keyword[]` + `locations[]` and let the actor build one
 *    search per pair ("each location is combined with every keyword"). Wider reach.
 *
 * Critically, we never send BOTH startUrls AND keyword/locations — doing so makes the
 * actor double-fetch (its own searches on top of ours) and was the ~1200-job blowup.
 */
function buildLinkedInInput(settings: Settings): Record<string, unknown> {
  const keywords = settings.keywords.filter(Boolean);
  const locations = settings.locations.filter(Boolean);
  const skills = (settings.skills ?? []).filter(Boolean);
  const combos: { keyword: string; location: string }[] = [];
  for (const k of keywords) for (const l of locations.length ? locations : ['']) combos.push({ keyword: k, location: l });

  // Total cap = Max jobs/run when set (the hard total limit); otherwise
  // results-per-role × #combos. Always floored to the actor minimum (150).
  let cap = settings.results_per_query * Math.max(1, combos.length);
  if (settings.max_jobs_per_run > 0) cap = settings.max_jobs_per_run;
  cap = Math.max(cap, MIN_MAX_ITEMS);

  const base = {
    maxItems: cap, // hard global cap on the whole run
    saveOnlyUniqueItems: true,
    // Skill-match (ADR 0018): the actor tags each job with matched/unmatched skills + a 0–100 score.
    resumeKeywords: skills.map((s) => ({ keyword: s })),
    publishedAt: mapPublishedAt(settings.hours_old),
    proxy: { useApifyProxy: true },
  };

  if (settings.fetch_mode === 'keyword') {
    // Broad: actor builds one search per keyword × location pair (no startUrls).
    return { ...base, keyword: keywords, locations };
  }
  // Precise (default): crawl exactly the searches we define, one per role × location.
  return { ...base, startUrls: combos.map((c) => ({ url: buildLinkedInSearchUrl(c.keyword, c.location, settings.hours_old) })) };
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

// ── Portal registry ───────────────────────────────────────────────────────

interface PortalConfig {
  /** Default Apify actor ID. LinkedIn overrides this with settings.apify_actor_id. */
  actorId: string;
  buildInput: (s: Settings) => Record<string, unknown>;
}

const PORTAL_CONFIG: Record<string, PortalConfig> = {
  linkedin:  { actorId: 'bebity~linkedin-jobs-scraper',    buildInput: buildLinkedInInput },
  indeed:    { actorId: 'misceres~indeed-scraper',          buildInput: buildIndeedInput },
  glassdoor: { actorId: 'bebity~glassdoor-jobs-scraper',   buildInput: buildGlassdoorInput },
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

/**
 * Start all planned Apify runs in parallel — one per enabled portal. Every webhook
 * URL carries ?portal=<key> so the handler sets source correctly.
 */
export async function startAllPortalRuns(settings: Settings, webhookUrl: string): Promise<StartedRun[]> {
  const specs = planRuns(settings);
  const apify = await client();
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
      return { runId: run.id, defaultDatasetId: run.defaultDatasetId };
    }),
  );
  return results.filter((r): r is StartedRun => r !== null);
}

/** @deprecated Use startAllPortalRuns. Left for tests that import it directly. */
export async function startActorRun(settings: Settings, webhookUrl: string): Promise<StartedRun> {
  const run = await (await client())
    .actor(settings.apify_actor_id)
    .start(buildActorInput(settings), {
      webhooks: [
        {
          eventTypes: ['ACTOR.RUN.SUCCEEDED', 'ACTOR.RUN.FAILED', 'ACTOR.RUN.TIMED_OUT', 'ACTOR.RUN.ABORTED'],
          requestUrl: webhookUrl,
        },
      ],
    });
  return { runId: run.id, defaultDatasetId: run.defaultDatasetId };
}

// ── Dataset helpers ───────────────────────────────────────────────────────

export async function fetchDatasetItems(datasetId: string): Promise<Record<string, unknown>[]> {
  const { items } = await (await client()).dataset(datasetId).listItems();
  return items as Record<string, unknown>[];
}

export async function getRunDatasetId(runId: string): Promise<string | null> {
  const run = await (await client()).run(runId).get();
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

export interface MappedJob {
  url: string;
  title: string | null;
  company: string | null;
  location: string | null;
  salary: string | null;
  full_description: string | null;
  application_url: string | null;
  easy_apply: boolean | null;
  /** Company headcount/size text when an actor provides it (often absent in job-search results). */
  company_size: string | null;
  /** Skill-match outputs from the actor's resumeKeywords feature (ADR 0018); null when not provided. */
  skill_match_score: number | null;
  matched_skills: string[] | null;
  unmatched_skills: string[] | null;
  source: string;
}

/** Map one dataset item to a job row. Returns null if it has no usable URL. */
export function mapDatasetItemToJob(item: Record<string, unknown>, source: string): MappedJob | null {
  const url = firstString(item, ['url', 'jobUrl', 'link', 'jobPostingUrl', 'job_url']);
  if (!url) return null;
  const applyUrl = firstString(item, ['applyUrl', 'applicationUrl', 'externalApplyLink', 'companyApplyUrl', 'applyLink']);
  const skillPct = firstNumber(item, ['keywordMatchScorePercentage', 'keywordMatchScore', 'matchScorePercentage']);
  return {
    url,
    title: firstString(item, ['title', 'jobTitle', 'positionName', 'position']),
    company: firstString(item, ['companyName', 'company', 'company_name', 'employer']),
    location: firstString(item, ['location', 'place', 'jobLocation']),
    salary: firstString(item, ['salary', 'salaryInfo', 'compensation']),
    full_description: firstString(item, ['description', 'descriptionText', 'jobDescription', 'fullDescription', 'descriptionHtml']),
    application_url: applyUrl ?? url,
    // LinkedIn actors expose easyApply as a boolean; other portals return null.
    easy_apply: firstBool(item, ['easyApply', 'isEasyApply', 'easy_apply', 'isEasyApplyJob']),
    company_size: firstSize(item, [
      'companySize', 'companySizeRange', 'employeeCount', 'numEmployees', 'companyEmployeesCount', 'staffCount', 'employees',
    ]),
    skill_match_score: skillPct == null ? null : Math.max(0, Math.min(100, Math.round(skillPct))),
    matched_skills: stringArray(item, 'matchedKeywords'),
    unmatched_skills: stringArray(item, 'unmatchedKeywords'),
    source,
  };
}
