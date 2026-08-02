import { describe, it, expect } from 'vitest';
import {
  planRuns, mapDatasetItemToJob, parseLinkedInLocation, linkedInKeywordLocations,
  mapDatasetItemsToJobs, titleSearchTerms, careerSiteLocations, estimateRunCostUsd,
  normalizeEmploymentType,
} from './apify';
import type { Settings } from './types';
import {
  CURIOUS_CODER_LINKEDIN_ACTOR_ID,
  validateLinkedInSearchUrlLibrary,
  validateLinkedInSearchUrls,
} from './linkedinScrapers';

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
    chat_provider: 'openai',
    chat_model: 'gpt-4o-mini',
    score_provider: 'openai',
    score_model: 'gpt-4o-mini',
    tailor_provider: 'anthropic',
    tailor_model: 'claude-sonnet-4-6',
    resume_worker_url: null,
    resume_worker_secret: null,
    apify_actor_id: 'cheap_scraper~linkedin-job-scraper',
    linkedin_search_urls: [],
    linkedin_search_url_options: [],
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
    allow_delete_scores: false,
    updated_at: '2026-06-18T00:00:00Z',
    ...over,
  };
}

describe('planRuns — keyword-mode LinkedIn run with native filters (ADR 0110)', () => {
  it('sends plain keyword × location searches — never startUrls, never a boolean query', () => {
    const specs = planRuns(makeSettings());
    expect(specs).toHaveLength(1);
    const run = specs[0];
    expect(run.portal).toBe('linkedin');
    expect(run.actorId).toBe('cheap_scraper~linkedin-job-scraper');

    // Plain keywords: the actor only paginates unquoted searches (builds ≥0.0.35).
    expect(run.input.keyword).toEqual(['Software Engineer', 'Data Engineer', 'ML Engineer', 'Backend Engineer']);
    expect(run.input.locations).toEqual(['United States', 'Boston, MA']);
    // startUrls alongside keyword/locations makes the actor double-fetch.
    expect(run.input.startUrls).toBeUndefined();
    expect(run.input.urls).toBeUndefined();
  });

  it('always filters to full-time + contract in-search (was f_JT=F,C)', () => {
    expect(planRuns(makeSettings())[0].input.jobType).toEqual(['full-time', 'contract']);
  });

  it('maps stored f_E digits to the native experienceLevel enum; none selected → no filter', () => {
    const specs = planRuns(makeSettings({ linkedin_experience_levels: ['2', '3', '4'] }));
    expect(specs[0].input.experienceLevel).toEqual(['entry-level', 'associate', 'mid-senior']);
    expect(planRuns(makeSettings())[0].input.experienceLevel).toBeUndefined();
  });

  it('collapses remote-ish locations into their geo; remote-ONLY lists add the workType filter', () => {
    // Mixed list: "Remote, US" folds into "United States"; the plain geo search
    // already includes remote rows, so no workType restriction.
    const mixed = planRuns(makeSettings({ locations: ['United States', 'Remote, US'] }))[0].input;
    expect(mixed.locations).toEqual(['United States']);
    expect(mixed.workType).toBeUndefined();

    // Every saved location remote → restrict the search to remote jobs.
    const remoteOnly = planRuns(makeSettings({ locations: ['Remote, US'] }))[0].input;
    expect(remoteOnly.locations).toEqual(['United States']);
    expect(remoteOnly.workType).toEqual(['remote']);
  });

  it('never searches without a location (worldwide = unbounded billing)', () => {
    expect(planRuns(makeSettings({ locations: [] }))[0].input.locations).toEqual(['United States']);
  });

  it('de-duplicates so overlapping searches are billed once', () => {
    expect(planRuns(makeSettings())[0].input.saveOnlyUniqueItems).toBe(true);
  });

  it('keeps the look-back window param', () => {
    expect(planRuns(makeSettings())[0].input.publishedAt).toBe('r86400');
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

  it('keeps non-LinkedIn portals as their own single run', () => {
    const specs = planRuns(makeSettings({ job_portals: ['linkedin', 'indeed'] }));
    expect(specs.filter((s) => s.portal === 'linkedin')).toHaveLength(1);
    expect(specs.filter((s) => s.portal === 'indeed')).toHaveLength(1);
  });

  it('passes the user skills to the actor as resumeKeywords', () => {
    const input = planRuns(makeSettings())[0].input;
    expect(input.resumeKeywords).toEqual([{ keyword: 'React' }, { keyword: 'TypeScript' }]);
  });
});

describe('LinkedIn scraper adapter registry (ADR 0113)', () => {
  const filteredUrl = 'https://www.linkedin.com/jobs/search/?keywords=Platform%20Engineer&f_TPR=r86400&f_WT=2';

  it('builds the Curious Coder URL contract instead of the criteria contract', () => {
    const run = planRuns(makeSettings({
      apify_actor_id: CURIOUS_CODER_LINKEDIN_ACTOR_ID,
      linkedin_search_urls: [filteredUrl],
      max_jobs_per_run: 250,
    }))[0];

    expect(run.actorId).toBe(CURIOUS_CODER_LINKEDIN_ACTOR_ID);
    expect(run.input).toMatchObject({
      urls: [filteredUrl],
      count: 250,
      scrapeCompany: true,
    });
    expect(run.input.useIncognitoMode).toBeUndefined();
    expect(run.input.splitByLocation).toBeUndefined();
    expect(run.input.keyword).toBeUndefined();
    expect(run.input.locations).toBeUndefined();
    expect(run.estimatedResults).toBe(250);
    expect(run.pricePerResultUsd).toBe(0.001);
  });

  it('requires a saved search URL before planning a URL-driven run', () => {
    expect(() => planRuns(makeSettings({
      apify_actor_id: CURIOUS_CODER_LINKEDIN_ACTOR_ID,
      linkedin_search_urls: [],
    }))).toThrow(/requires at least one LinkedIn Jobs search URL/i);
  });

  it('validates reusable LinkedIn search URLs and rejects job-detail or lookalike hosts', () => {
    const result = validateLinkedInSearchUrls([
      filteredUrl,
      filteredUrl,
      'https://www.linkedin.com/jobs/view/123',
      'https://linkedin.com.example.test/jobs/search/?keywords=x',
    ]);
    expect(result.urls).toEqual([filteredUrl]);
    expect(result.invalid).toHaveLength(2);
  });

  it('keeps a saved URL library while sending only its active de-duplicated subset', () => {
    const secondUrl = 'https://www.linkedin.com/jobs/search/?keywords=Data%20Engineer&f_TPR=r86400';
    const library = validateLinkedInSearchUrlLibrary(
      [filteredUrl, secondUrl, filteredUrl],
      [secondUrl, secondUrl],
    );
    expect(library).toEqual({
      savedUrls: [filteredUrl, secondUrl],
      activeUrls: [secondUrl],
      invalid: [],
    });

    const run = planRuns(makeSettings({
      apify_actor_id: CURIOUS_CODER_LINKEDIN_ACTOR_ID,
      linkedin_search_url_options: library.savedUrls,
      linkedin_search_urls: library.activeUrls,
      max_jobs_per_run: 250,
    }))[0];
    expect(run.input.urls).toEqual([secondUrl]);
  });

  it('promotes a newly active URL into the saved library for deployment compatibility', () => {
    const secondUrl = 'https://www.linkedin.com/jobs/search/?keywords=Data%20Engineer&f_TPR=r86400';
    const library = validateLinkedInSearchUrlLibrary([filteredUrl], [secondUrl]);
    expect(library.savedUrls).toEqual([filteredUrl, secondUrl]);
    expect(library.activeUrls).toEqual([secondUrl]);
  });

  it('uses the registered actor price in the preflight estimate', () => {
    expect(estimateRunCostUsd(makeSettings({
      apify_actor_id: CURIOUS_CODER_LINKEDIN_ACTOR_ID,
      linkedin_search_urls: [filteredUrl],
      max_jobs_per_run: 1000,
    }))).toBe(1.3);
  });

  it('normalizes Curious Coder salary arrays and apply methods', () => {
    const job = mapDatasetItemToJob({
      link: 'https://www.linkedin.com/jobs/view/123',
      title: 'Platform Engineer',
      salaryInfo: ['$150,000', '$180,000'],
      applyMethod: { type: 'Easy Apply' },
    }, 'apify:linkedin', CURIOUS_CODER_LINKEDIN_ACTOR_ID);
    expect(job?.salary).toBe('$150,000 – $180,000');
    expect(job?.easy_apply).toBe(true);
  });

  it('discards exact job-URL duplicates returned by overlapping active searches', () => {
    const jobs = mapDatasetItemsToJobs([
      { link: 'https://www.linkedin.com/jobs/view/123', title: 'Platform Engineer' },
      { link: 'https://www.linkedin.com/jobs/view/123', title: 'Repeated copy' },
      { link: 'https://www.linkedin.com/jobs/view/456', title: 'Data Engineer' },
    ], 'apify:linkedin', CURIOUS_CODER_LINKEDIN_ACTOR_ID);
    expect(jobs.map((job) => job.url)).toEqual([
      'https://www.linkedin.com/jobs/view/123',
      'https://www.linkedin.com/jobs/view/456',
    ]);
    expect(jobs[0].title).toBe('Platform Engineer');
  });
});

describe('LinkedIn location helpers', () => {
  it('parseLinkedInLocation maps remote variants to United States + remote', () => {
    expect(parseLinkedInLocation('Remote, US')).toEqual({ location: 'United States', remote: true });
    expect(parseLinkedInLocation('Remote')).toEqual({ location: 'United States', remote: true });
    expect(parseLinkedInLocation('Remote, New York, NY')).toEqual({ location: 'New York, NY', remote: true });
    expect(parseLinkedInLocation('Boston, MA')).toEqual({ location: 'Boston, MA', remote: false });
  });

  it('linkedInKeywordLocations de-duplicates geos case-insensitively and reports remote-only', () => {
    expect(linkedInKeywordLocations(['Boston, MA', 'boston, ma', 'Remote, US'])).toEqual({
      locations: ['Boston, MA', 'United States'],
      remoteOnly: false,
    });
    expect(linkedInKeywordLocations(['Remote, US', 'Remote'])).toEqual({
      locations: ['United States'],
      remoteOnly: true,
    });
    expect(linkedInKeywordLocations([])).toEqual({ locations: ['United States'], remoteOnly: false });
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

describe('estimateRunCostUsd — the pre-run credit headroom a key must have (ADR 0059)', () => {
  it('floors at $0.75 for a default LinkedIn-only fetch', () => {
    // 4 roles × 2 locations × 50 = 400 jobs × $0.0007 × 1.3 ≈ $0.36 → floor.
    expect(estimateRunCostUsd(makeSettings())).toBe(0.75);
    // Even the user's 800-job hard cap stays under the floor (≈ $0.73).
    expect(estimateRunCostUsd(makeSettings({ max_jobs_per_run: 800 }))).toBe(0.75);
  });

  it('scales with expensive portals (career_sites at $12/1k dominates)', () => {
    const usd = estimateRunCostUsd(makeSettings({ job_portals: ['linkedin', 'career_sites'], career_sites_max_jobs: 150 }));
    // (400×0.0007 + 150×0.012) × 1.3 = $2.70
    expect(usd).toBeCloseTo(2.7, 2);
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

describe('mapDatasetItemToJob — filter metadata (ADR 0078)', () => {
  it('maps cheap_scraper contractType and applyType before AI scoring', () => {
    const fullTime = mapDatasetItemToJob({
      url: 'https://x/job/3', contractType: 'Full-time', applyType: 'EXTERNAL',
    }, 'linkedin');
    expect(fullTime?.employment_type).toBe('full_time');
    expect(fullTime?.easy_apply).toBe(false);

    const contract = mapDatasetItemToJob({
      url: 'https://x/job/4', contractType: 'Contract', applyType: 'EASY_APPLY',
    }, 'linkedin');
    expect(contract?.employment_type).toBe('contract');
    expect(contract?.easy_apply).toBe(true);
  });

  it('normalizes common actor employment labels', () => {
    expect(normalizeEmploymentType('Full-time')).toBe('full_time');
    expect(normalizeEmploymentType('Freelance contract')).toBe('contract');
    expect(normalizeEmploymentType('Internship')).toBe('internship');
    expect(normalizeEmploymentType('Temporary')).toBe('unknown');
    expect(normalizeEmploymentType(null)).toBeNull();
  });
});
