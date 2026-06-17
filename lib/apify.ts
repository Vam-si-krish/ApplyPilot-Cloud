/**
 * Apify integration — the ONLY place that knows actor input/output schema
 * (ADR 0005). Swapping actors should touch only this file + settings.apify_actor_id.
 *
 * Default actor: bebity~linkedin-jobs-scraper. Its exact field names must be
 * confirmed against a real run; buildActorInput emits a superset and
 * mapDatasetItemToJob reads multiple candidate keys defensively.
 */
import { ApifyClient } from 'apify-client';
import type { Settings } from './types';

function client(): ApifyClient {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error('Missing required environment variable: APIFY_TOKEN');
  return new ApifyClient({ token });
}

/** Build a LinkedIn job-search URL for one keyword × location, last-N-hours window. */
export function buildLinkedInSearchUrl(keyword: string, location: string, hoursOld: number): string {
  const params = new URLSearchParams({
    keywords: keyword,
    location: location,
    f_TPR: `r${Math.max(1, Math.round(hoursOld * 3600))}`, // LinkedIn "posted in last N seconds"
  });
  return `https://www.linkedin.com/jobs/search/?${params.toString()}`;
}

/**
 * Map user settings → actor input. Emits both single-field (title/location) and
 * a urls[] of keyword×location search pages so a range of LinkedIn actors work.
 */
export function buildActorInput(settings: Settings): Record<string, unknown> {
  const keywords = settings.keywords.filter(Boolean);
  const locations = settings.locations.filter(Boolean);
  const combos: { keyword: string; location: string }[] = [];
  for (const k of keywords) for (const l of locations) combos.push({ keyword: k, location: l });

  return {
    title: keywords[0] ?? '',
    location: locations[0] ?? '',
    rows: settings.results_per_query,
    maxItems: settings.results_per_query * Math.max(1, combos.length),
    publishedAt: `r${Math.max(1, Math.round(settings.hours_old * 3600))}`,
    urls: combos.map((c) => buildLinkedInSearchUrl(c.keyword, c.location, settings.hours_old)),
    proxy: { useApifyProxy: true },
  };
}

export interface StartedRun {
  runId: string;
  defaultDatasetId: string;
}

/**
 * Start the actor run ASYNC (returns immediately) with an ad-hoc webhook that
 * calls webhookUrl on success/failure. Never blocks on the scrape (ADR 0004).
 */
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

/** Fetch all dataset items for a finished run. */
export async function fetchDatasetItems(datasetId: string): Promise<Record<string, unknown>[]> {
  const { items } = await client().dataset(datasetId).listItems();
  return items as Record<string, unknown>[];
}

/** Look up a run's dataset id (the webhook payload may not carry it directly). */
export async function getRunDatasetId(runId: string): Promise<string | null> {
  const run = await client().run(runId).get();
  return run?.defaultDatasetId ?? null;
}

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

export interface MappedJob {
  url: string;
  title: string | null;
  company: string | null;
  location: string | null;
  salary: string | null;
  full_description: string | null;
  application_url: string | null;
  source: string;
}

/** Map one dataset item to a job row. Returns null if it has no usable URL. */
export function mapDatasetItemToJob(item: Record<string, unknown>, source: string): MappedJob | null {
  const url = firstString(item, ['url', 'jobUrl', 'link', 'jobPostingUrl', 'job_url']);
  if (!url) return null;
  const applyUrl = firstString(item, [
    'applyUrl',
    'applicationUrl',
    'externalApplyLink',
    'companyApplyUrl',
    'applyLink',
  ]);
  return {
    url,
    title: firstString(item, ['title', 'jobTitle', 'positionName', 'position']),
    company: firstString(item, ['companyName', 'company', 'company_name', 'employer']),
    location: firstString(item, ['location', 'place', 'jobLocation']),
    salary: firstString(item, ['salary', 'salaryInfo', 'compensation']),
    full_description: firstString(item, ['description', 'descriptionText', 'jobDescription', 'fullDescription', 'descriptionHtml']),
    application_url: applyUrl ?? url,
    source,
  };
}
