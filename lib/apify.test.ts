import { describe, it, expect } from 'vitest';
import { planRuns, perLocationLimit } from './apify';
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
    hours_old: 24,
    results_per_query: 50,
    location_limits: { 'Boston, MA': 25 },
    llm_provider: 'deepseek',
    llm_model: 'deepseek-chat',
    apify_actor_id: 'bebity~linkedin-jobs-scraper',
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

describe('perLocationLimit', () => {
  it('uses the per-location override when present', () => {
    expect(perLocationLimit(makeSettings(), 'Boston, MA')).toBe(25);
  });
  it('falls back to results_per_query when a location has no override', () => {
    expect(perLocationLimit(makeSettings(), 'United States')).toBe(50);
  });
  it('ignores zero / negative / non-numeric overrides', () => {
    const s = makeSettings({ location_limits: { 'Boston, MA': 0, 'United States': -5 } });
    expect(perLocationLimit(s, 'Boston, MA')).toBe(50);
    expect(perLocationLimit(s, 'United States')).toBe(50);
  });
});

describe('planRuns — LinkedIn fans out per location', () => {
  it('starts one run per location, each with its own cap', () => {
    const specs = planRuns(makeSettings());
    expect(specs).toHaveLength(2);
    expect(specs.every((s) => s.portal === 'linkedin')).toBe(true);
    expect(specs.every((s) => s.actorId === 'bebity~linkedin-jobs-scraper')).toBe(true);

    const us = specs.find((s) => s.input.location === 'United States')!;
    const boston = specs.find((s) => s.input.location === 'Boston, MA')!;

    // US has no override → default 50/role; 4 keywords → cap 200.
    expect(us.input.rows).toBe(50);
    expect(us.input.maxItems).toBe(200);
    expect((us.input.urls as string[]).length).toBe(4);

    // Boston override 25/role → cap 100.
    expect(boston.input.rows).toBe(25);
    expect(boston.input.maxItems).toBe(100);
    expect((boston.input.urls as string[]).length).toBe(4);

    // Each run's URLs target only its own location.
    expect((boston.input.urls as string[]).every((u) => u.includes('Boston'))).toBe(true);
  });

  it('uses one run with a blank location when no locations are set', () => {
    const specs = planRuns(makeSettings({ locations: [], location_limits: {} }));
    expect(specs).toHaveLength(1);
    expect(specs[0].input.location).toBe('');
    expect(specs[0].input.rows).toBe(50);
  });

  it('keeps non-LinkedIn portals as a single run alongside LinkedIn fan-out', () => {
    const specs = planRuns(makeSettings({ job_portals: ['linkedin', 'indeed'] }));
    const linkedin = specs.filter((s) => s.portal === 'linkedin');
    const indeed = specs.filter((s) => s.portal === 'indeed');
    expect(linkedin).toHaveLength(2); // one per location
    expect(indeed).toHaveLength(1); // single run
  });
});
