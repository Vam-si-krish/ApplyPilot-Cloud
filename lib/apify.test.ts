import { describe, it, expect } from 'vitest';
import { planRuns, mapDatasetItemToJob } from './apify';
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
    auto_rotate_keys: false,
    prefilter_enabled: false,
    prefilter_threshold: 30,
    min_skill_match: 0,
    max_jobs_per_run: 0,
    fetch_mode: 'url',
    auto_assess_enabled: true,
    auto_assess_min_score: 6,
    allow_rescore: false,
    updated_at: '2026-06-18T00:00:00Z',
    ...over,
  };
}

describe('planRuns — one URL-driven LinkedIn run (ADR 0023)', () => {
  it('covers every role × location via startUrls (no actor-side keyword/locations expansion)', () => {
    const specs = planRuns(makeSettings());
    expect(specs).toHaveLength(1);
    const run = specs[0];
    expect(run.portal).toBe('linkedin');
    expect(run.actorId).toBe('cheap_scraper~linkedin-job-scraper');

    // One startUrls entry per role × location (4 × 2 = 8) …
    expect((run.input.startUrls as { url: string }[]).length).toBe(8);
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

  it('handles no locations as a single keyword-only run', () => {
    const specs = planRuns(makeSettings({ locations: [] }));
    expect(specs).toHaveLength(1);
    expect((specs[0].input.startUrls as { url: string }[]).length).toBe(4); // 4 roles, blank location
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
