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

