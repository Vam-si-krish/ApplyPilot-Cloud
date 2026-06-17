/**
 * Apify integration — the ONLY place that knows actor input/output schema
 * (ADR 0005). Multi-portal: PORTAL_CONFIG maps portal keys to their default
 * actor IDs and input builders. LinkedIn uses settings.apify_actor_id so the
 * user can swap between cheap/standard variants from the Settings UI.
 */
import { ApifyClient } from 'apify-client';
import type { Settings } from './types';

function client(): ApifyClient {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error('Missing required environment variable: APIFY_TOKEN');
  return new ApifyClient({ token });
}

// ── Per-portal input builders ─────────────────────────────────────────────

/** Build a LinkedIn job-search URL for one keyword × location, last-N-hours window. */
export function buildLinkedInSearchUrl(keyword: string, location: string, hoursOld: number): string {
  const params = new URLSearchParams({
    keywords: keyword,
    location: location,
    f_TPR: `r${Math.max(1, Math.round(hoursOld * 3600))}`,
  });
  return `https://www.linkedin.com/jobs/search/?${params.toString()}`;
}

function buildLinkedInInput(settings: Settings): Record<string, unknown> {
  const keywords = settings.keywords.filter(Boolean);
  const locations = settings.locations.filter(Boolean);
  const combos: { keyword: string; location: string }[] = [];
  for (const k of keywords) for (const l of locations) combos.push({ keyword: k, location: l });
  return {
    title: keywords[0] ?? '',
    keyword: keywords,
    keywords,
    searchKeyword: keywords[0] ?? '',
    location: locations[0] ?? '',
    searchLocation: locations[0] ?? '',
    rows: settings.results_per_query,
    maxItems: settings.results_per_query * Math.max(1, combos.length),
    maxResults: settings.results_per_query * Math.max(1, combos.length),
    publishedAt: `r${Math.max(1, Math.round(settings.hours_old * 3600))}`,
    urls: combos.map((c) => buildLinkedInSearchUrl(c.keyword, c.location, settings.hours_old)),
    startUrls: combos.map((c) => ({ url: buildLinkedInSearchUrl(c.keyword, c.location, settings.hours_old) })),
    searchUrl: combos[0] ? buildLinkedInSearchUrl(combos[0].keyword, combos[0].location, settings.hours_old) : '',
    proxy: { useApifyProxy: true },
  };
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

/**
 * Start one Apify actor per enabled portal in parallel.
 * LinkedIn uses settings.apify_actor_id (lets the user pick cheap vs. standard).
 * Other portals use the default actor from PORTAL_CONFIG.
 * Each webhook URL carries ?portal=<key> so the webhook handler can set source correctly.
 */
export async function startAllPortalRuns(settings: Settings, webhookUrl: string): Promise<StartedRun[]> {
  const portals = settings.job_portals?.length ? settings.job_portals : ['linkedin'];
  const results = await Promise.all(
    portals.map(async (portal): Promise<StartedRun | null> => {
      const config = PORTAL_CONFIG[portal];
      if (!config) return null;
      const actorId = portal === 'linkedin' ? settings.apify_actor_id : config.actorId;
      const run = await client()
        .actor(actorId)
        .start(config.buildInput(settings), {
          webhooks: [
            {
              eventTypes: ['ACTOR.RUN.SUCCEEDED', 'ACTOR.RUN.FAILED', 'ACTOR.RUN.TIMED_OUT', 'ACTOR.RUN.ABORTED'],
              requestUrl: `${webhookUrl}&portal=${encodeURIComponent(portal)}`,
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
  const run = await client()
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
  const { items } = await client().dataset(datasetId).listItems();
  return items as Record<string, unknown>[];
}

export async function getRunDatasetId(runId: string): Promise<string | null> {
  const run = await client().run(runId).get();
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

export interface MappedJob {
  url: string;
  title: string | null;
  company: string | null;
  location: string | null;
  salary: string | null;
  full_description: string | null;
  application_url: string | null;
  easy_apply: boolean | null;
  source: string;
}

/** Map one dataset item to a job row. Returns null if it has no usable URL. */
export function mapDatasetItemToJob(item: Record<string, unknown>, source: string): MappedJob | null {
  const url = firstString(item, ['url', 'jobUrl', 'link', 'jobPostingUrl', 'job_url']);
  if (!url) return null;
  const applyUrl = firstString(item, ['applyUrl', 'applicationUrl', 'externalApplyLink', 'companyApplyUrl', 'applyLink']);
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
    source,
  };
}
