import { describe, it, expect } from 'vitest';
import {
  planRuns, mapDatasetItemToJob, booleanKeywordQuery, parseLinkedInLocation,
  buildLinkedInSearchUrl, titleSearchTerms, careerSiteLocations,
} from './apify';
import type { Settings } from './types';

function makeSettings(over: Partial<Settings> = {}): Settings {
  return {
    id: 1,
    schedule_time: '06:00',
    timezone: 'America/New_York',
    keywords: ['Software Engineer', 'Data Engineer', 'ML Engineer', 'Backend Engineer'],
    locations: ['United States', 'Boston, MA'],
    keyword_options: ['Software Engineer', 'Data Engineer', 'ML Engineer', 'Backend Engineer'],
    location_options: ['United States', 'Boston, MA'],
    skills: ['React', 'TypeScript'],
    hours_old: 24,
    results_per_query: 50,
    location_limits: {},
    llm_provider: 'deepseek',
    llm_model: 'deepseek-chat',
    score_provider: 'openai',
    score_model: 'gpt-4o-mini',
    tailor_provider: 'anthropic',
    tailor_model: 'claude-sonnet-4-6',
    resume_worker_url: null,
    resume_worker_secret: null,
    apify_actor_id: 'cheap_scraper~linkedin-job-scraper',
    job_portals: ['linkedin'],
    auto_scrape_enabled: true,
    auto_tailor_enabled: false,
    auto_tailor_time: '04:00',
    auto_rotate_keys: false,
    prefilter_enabled: false,
    prefilter_threshold: 30,
    min_skill_match: 0,
    max_jobs_per_run: 0,
    career_sites_max_jobs: 150,
    fetch_mode: 'url',
    linkedin_experience_levels: [],
    auto_assess_enabled: true,
    auto_assess_min_score: 6,
    allow_delete_scores: false,
    updated_at: '2026-06-18T00:00:00Z',
    ...over,
  };
}

describe('planRuns — one URL-driven LinkedIn run (ADR 0023, boolean query per ADR 0058)', () => {
  it('covers every role × location via ONE boolean startUrl per location', () => {
    const specs = planRuns(makeSettings());
    expect(specs).toHaveLength(1);
    const run = specs[0];
    expect(run.portal).toBe('linkedin');
    expect(run.actorId).toBe('cheap_scraper~linkedin-job-scraper');

    // One startUrls entry per LOCATION (2), all roles OR-combined in each …
    const urls = (run.input.startUrls as { url: string }[]).map((u) => u.url);
    expect(urls.length).toBe(2);
    const q = new URL(urls[0]).searchParams.get('keywords');
    expect(q).toBe('"Software Engineer" OR "Data Engineer" OR "ML Engineer" OR "Backend Engineer"');
    // … and we DON'T send keyword/locations arrays (which would double-fetch).
    expect(run.input.locations).toBeUndefined();
    expect(run.input.keyword).toBeUndefined();
    expect(run.input.urls).toBeUndefined();
  });

  it('de-duplicates so overlapping locations are billed once', () => {
    expect(planRuns(makeSettings())[0].input.saveOnlyUniqueItems).toBe(true);
  });

  it('caps maxItems at results_per_query × combos, floored to the actor minimum (150)', () => {
    // 4 roles × 2 locations × 50 = 400.
    expect(planRuns(makeSettings()).at(0)!.input.maxItems).toBe(400);
    // Small selection (1 role × 1 location × 50 = 50) floors to 150.
    const small = planRuns(makeSettings({ keywords: ['Software Engineer'], locations: ['United States'] }));
    expect(small[0].input.maxItems).toBe(150);
  });

  it('treats max_jobs_per_run as the HARD total cap (overrides the combos product)', () => {
    // 4 × 2 × 50 = 400, but the user's hard cap wins → 200.
    expect(planRuns(makeSettings({ max_jobs_per_run: 200 }))[0].input.maxItems).toBe(200);
    // The cap holds even when combos would imply far more (this was the 1200-job bug).
    expect(planRuns(makeSettings({ max_jobs_per_run: 500 }))[0].input.maxItems).toBe(500);
    // A cap below the floor still yields 150.
    expect(planRuns(makeSettings({ max_jobs_per_run: 50 }))[0].input.maxItems).toBe(150);
  });

  it('handles no locations as a single boolean search with a blank location', () => {
    const specs = planRuns(makeSettings({ locations: [] }));
    expect(specs).toHaveLength(1);
    expect((specs[0].input.startUrls as { url: string }[]).length).toBe(1); // one boolean query, blank location
  });

  it('turns remote-ish locations into a real remote search (f_WT=2 on United States)', () => {
    const specs = planRuns(makeSettings({ locations: ['Remote, US'] }));
    const url = new URL((specs[0].input.startUrls as { url: string }[])[0].url);
    expect(url.searchParams.get('location')).toBe('United States');
    expect(url.searchParams.get('f_WT')).toBe('2');
  });

  it('bakes experience levels (f_E) and full-time+contract (f_JT) into every search URL', () => {
    const specs = planRuns(makeSettings({ linkedin_experience_levels: ['2', '3', '4'] }));
    for (const { url } of specs[0].input.startUrls as { url: string }[]) {
      const params = new URL(url).searchParams;
      expect(params.get('f_E')).toBe('2,3,4');
      expect(params.get('f_JT')).toBe('F,C');
    }
    // No levels selected → no f_E facet at all.
    const bare = planRuns(makeSettings());
    expect(new URL((bare[0].input.startUrls as { url: string }[])[0].url).searchParams.get('f_E')).toBeNull();
  });

  it('keeps non-LinkedIn portals as their own single run', () => {
    const specs = planRuns(makeSettings({ job_portals: ['linkedin', 'indeed'] }));
    expect(specs.filter((s) => s.portal === 'linkedin')).toHaveLength(1);
    expect(specs.filter((s) => s.portal === 'indeed')).toHaveLength(1);
  });

  it('passes the user skills to the actor as resumeKeywords', () => {
    const input = planRuns(makeSettings())[0].input;
    expect(input.resumeKeywords).toEqual([{ keyword: 'React' }, { keyword: 'TypeScript' }]);
  });

  it("'keyword' fetch mode uses keyword/locations (not startUrls) — no double-fetch", () => {
    const input = planRuns(makeSettings({ fetch_mode: 'keyword' }))[0].input;
    expect(input.keyword).toEqual(['Software Engineer', 'Data Engineer', 'ML Engineer', 'Backend Engineer']);
    expect(input.locations).toEqual(['United States', 'Boston, MA']);
    expect(input.startUrls).toBeUndefined();
    // Same hard cap applies in both modes.
    expect(planRuns(makeSettings({ fetch_mode: 'keyword', max_jobs_per_run: 500 }))[0].input.maxItems).toBe(500);
  });
});

describe('LinkedIn query helpers (ADR 0058)', () => {
  it('booleanKeywordQuery quotes phrases and ORs them; single keyword stays bare', () => {
    expect(booleanKeywordQuery(['React Developer', 'React.js'])).toBe('"React Developer" OR "React.js"');
    expect(booleanKeywordQuery(['React Developer'])).toBe('React Developer');
    expect(booleanKeywordQuery([])).toBe('');
  });

  it('parseLinkedInLocation maps remote variants to United States + remote', () => {
    expect(parseLinkedInLocation('Remote, US')).toEqual({ location: 'United States', remote: true });
    expect(parseLinkedInLocation('Remote')).toEqual({ location: 'United States', remote: true });
    expect(parseLinkedInLocation('Remote, New York, NY')).toEqual({ location: 'New York, NY', remote: true });
    expect(parseLinkedInLocation('Boston, MA')).toEqual({ location: 'Boston, MA', remote: false });
  });

  it('buildLinkedInSearchUrl keeps the last-24h window param', () => {
    const url = new URL(buildLinkedInSearchUrl('x', 'Boston, MA', 24));
    expect(url.searchParams.get('f_TPR')).toBe('r86400');
    expect(url.searchParams.get('f_WT')).toBeNull();
  });
});

describe('career_sites portal (ADR 0058, opt-in)', () => {
  it('titleSearchTerms: .js → prefix token, Frontend↔Front End variants, subsumed terms dropped', () => {
    expect(titleSearchTerms([
      'Senior Frontend Developer', 'Frontend Engineer', 'React Developer', 'Frontend Developer', 'React.js',
    ])).toEqual(['Frontend Engineer', 'Front End Engineer', 'Frontend Developer', 'Front End Developer', 'React:*']);
  });

  it('careerSiteLocations: state expansion, remote→US, country subsumes metros, never unfiltered', () => {
    expect(careerSiteLocations(['New York, NY'])).toEqual(['New York, New York, United States']);
    expect(careerSiteLocations(['Remote, US', 'Boston, MA'])).toEqual(['United States']);
    expect(careerSiteLocations([])).toEqual(['United States']);
  });

  it('plans a capped, filtered run only when the portal is opted in', () => {
    expect(planRuns(makeSettings()).some((r) => r.portal === 'career_sites')).toBe(false);

    const spec = planRuns(makeSettings({ job_portals: ['linkedin', 'career_sites'], career_sites_max_jobs: 200 }))
      .find((r) => r.portal === 'career_sites')!;
    expect(spec.actorId).toBe('fantastic-jobs~career-site-job-listing-api');
    expect(spec.input.limit).toBe(200); // the $-per-run dial
    expect(spec.input.timeRange).toBe('24h');
    expect(spec.input.descriptionType).toBe('text');
    expect(spec.input.removeAgency).toBe(true);
    expect(spec.input.locationSearch).toEqual(['United States']);
  });

  it('maps a fantastic.jobs dataset item (organization, derived location, ai salary)', () => {
    const job = mapDatasetItemToJob(
      {
        url: 'https://boards.greenhouse.io/x/jobs/1',
        title: 'Frontend Engineer',
        organization: 'Acme',
        locations_derived: ['Boston, Massachusetts, United States'],
        remote_derived: true,
        description_text: 'Build UIs.',
        ai_salary_min_value: 150000,
        ai_salary_max_value: 180000,
        ai_salary_currency: 'USD',
        ai_salary_unit_text: 'YEAR',
        org_linkedin_size: '51-200',
      },
      'apify:career_sites',
    );
    expect(job?.company).toBe('Acme');
    expect(job?.location).toBe('Remote — Boston, Massachusetts, United States');
    expect(job?.full_description).toBe('Build UIs.');
    expect(job?.salary).toBe('150000–180000 USD / YEAR');
    expect(job?.company_size).toBe('51-200');
    expect(job?.source).toBe('apify:career_sites');
  });
});

describe('mapDatasetItemToJob — skill-match outputs (ADR 0018)', () => {
  it('extracts the score (clamped/rounded) + matched/unmatched skills', () => {
    const job = mapDatasetItemToJob(
      {
        url: 'https://x/job/1',
        title: 'Frontend Engineer',
        keywordMatchScorePercentage: 66.7,
        matchedKeywords: ['React', 'TypeScript'],
        unmatchedKeywords: ['Node.js'],
      },
      'linkedin',
    );
    expect(job?.skill_match_score).toBe(67);
    expect(job?.matched_skills).toEqual(['React', 'TypeScript']);
    expect(job?.unmatched_skills).toEqual(['Node.js']);
  });

  it('leaves skill fields null when the actor returns none', () => {
    const job = mapDatasetItemToJob({ url: 'https://x/job/2', title: 'Backend' }, 'linkedin');
    expect(job?.skill_match_score).toBeNull();
    expect(job?.matched_skills).toBeNull();
  });
});
