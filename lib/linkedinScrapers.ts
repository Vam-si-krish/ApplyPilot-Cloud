import type { Settings } from './types';

export const CHEAP_LINKEDIN_ACTOR_ID = 'cheap_scraper~linkedin-job-scraper';
export const CURIOUS_CODER_LINKEDIN_ACTOR_ID = 'curious_coder~linkedin-jobs-scraper';

export type LinkedInInputMode = 'criteria' | 'search_urls';

/** Safe client-side metadata for the Settings selector. */
export const LINKEDIN_SCRAPER_OPTIONS = [
  {
    actorId: CHEAP_LINKEDIN_ACTOR_ID,
    label: 'Keyword search — $0.70 / 1k results (cheap_scraper)',
    description: 'Builds searches from ApplyPilot roles, locations, and experience filters.',
    inputMode: 'criteria' as const,
  },
  {
    actorId: CURIOUS_CODER_LINKEDIN_ACTOR_ID,
    label: 'Filtered LinkedIn URLs — $1.00 / 1k results (curious_coder)',
    description: 'Uses the complete filters already encoded in LinkedIn Jobs search URLs.',
    inputMode: 'search_urls' as const,
  },
] as const;

function isLinkedInHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, '');
  return normalized === 'linkedin.com' || normalized.endsWith('.linkedin.com');
}

export interface LinkedInUrlValidation {
  urls: string[];
  invalid: string[];
}

export interface LinkedInUrlLibraryValidation {
  savedUrls: string[];
  activeUrls: string[];
  invalid: string[];
}

/** Effective Curious Coder `count`, shared by run planning and the Settings preview. */
export function curiousCoderResultCap(
  settings: Pick<Settings, 'max_jobs_per_run' | 'results_per_query' | 'linkedin_search_urls'>,
): number {
  const configured = settings.max_jobs_per_run > 0
    ? settings.max_jobs_per_run
    : settings.results_per_query * Math.max(1, (settings.linkedin_search_urls ?? []).length);
  return Math.max(configured, 10);
}

/**
 * Validate, normalize, and de-duplicate saved LinkedIn search URLs. Job-detail URLs
 * are intentionally rejected: URL-driven actors expect reusable search results.
 */
export function validateLinkedInSearchUrls(values: unknown[]): LinkedInUrlValidation {
  const urls: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const raw = String(value).trim();
    if (!raw) continue;
    try {
      const parsed = new URL(raw);
      const path = parsed.pathname.replace(/\/+$/, '');
      if (
        parsed.protocol !== 'https:'
        || !isLinkedInHostname(parsed.hostname)
        || !(/^\/jobs\/search(?:-results)?$/i.test(path))
      ) {
        invalid.push(raw);
        continue;
      }
      parsed.hash = '';
      const normalized = parsed.toString();
      if (!seen.has(normalized)) {
        seen.add(normalized);
        urls.push(normalized);
      }
    } catch {
      invalid.push(raw);
    }
  }
  return { urls, invalid };
}

/**
 * Normalize a saved URL library and its independently active subset. The API uses
 * this at the persistence boundary so a caller cannot activate an unpersisted URL.
 */
export function validateLinkedInSearchUrlLibrary(
  savedValues: unknown[],
  activeValues: unknown[],
): LinkedInUrlLibraryValidation {
  const saved = validateLinkedInSearchUrls(savedValues);
  const active = validateLinkedInSearchUrls(activeValues);
  const savedSet = new Set(saved.urls);
  const newlySavedActiveUrls = active.urls.filter((url) => !savedSet.has(url));
  return {
    // Promoting a newly active URL into the library keeps an older frontend safe
    // during deployment overlap and makes the persisted active-is-saved invariant.
    savedUrls: [...saved.urls, ...newlySavedActiveUrls],
    activeUrls: active.urls,
    invalid: [...saved.invalid, ...active.invalid],
  };
}
