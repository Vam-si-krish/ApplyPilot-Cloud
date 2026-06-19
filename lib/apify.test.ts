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
    apify_actor_id: 'cheap_scraper~linkedin-job-scraper',
    job_portals: ['linkedin'],
    auto_scrape_enabled: true,
    auto_rotate_keys: false,
    prefilter_enabled: false,
    prefilter_threshold: 30,
    auto_assess_enabled: true,
    auto_assess_min_score: 6,
    updated_at: '2026-06-18T00:00:00Z',
    ...over,
  };
}

describe('planRuns — one combined, de-duplicated LinkedIn run', () => {
  it('covers every role × location in a single run', () => {
    const specs = planRuns(makeSettings());
    expect(specs).toHaveLength(1);
    const run = specs[0];
    expect(run.portal).toBe('linkedin');
    expect(run.actorId).toBe('cheap_scraper~linkedin-job-scraper');

    // All selected locations ride in the actor's multi-location field…
    expect(run.input.locations).toEqual(['United States', 'Boston, MA']);
    // …and there's one search URL per role × location (4 × 2 = 8).
    expect((run.input.urls as string[]).length).toBe(8);
    expect((run.input.startUrls as { url: string }[]).length).toBe(8);
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

  it('handles no locations as a single keyword-only run', () => {
    const specs = planRuns(makeSettings({ locations: [] }));
    expect(specs).toHaveLength(1);
    expect(specs[0].input.locations).toEqual([]);
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
