import { describe, it, expect } from 'vitest';
import { jobContentKey, partitionByGeneration, pickCanonical } from './dedupe';

describe('jobContentKey (ADR 0057, aggressive company+title mode)', () => {
  it('groups the same company+title even when the body varies per city', () => {
    const a = jobContentKey('Deloitte', 'Software Engineer II', 'Build React apps in Seattle. Salary $150k-$180k (WA).');
    const b = jobContentKey('Deloitte', 'Software Engineer II', 'Build React apps in Tampa. Salary $120k-$150k (FL).');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
  });

  it('ignores case, whitespace, and HTML variations (repost noise)', () => {
    const a = jobContentKey('Deloitte', 'Software Engineer II', 'x');
    const b = jobContentKey('DELOITTE ', ' Software   Engineer II', 'y');
    expect(a).toBe(b);
  });

  it('differs when the company or title genuinely differ', () => {
    const base = jobContentKey('Deloitte', 'Software Engineer II', 'Build React apps.');
    expect(jobContentKey('Epic', 'Software Engineer II', 'Build React apps.')).not.toBe(base);
    expect(jobContentKey('Deloitte', 'Software Engineer III', 'Build React apps.')).not.toBe(base);
  });

  it('falls back to the body when company or title is missing (no half-empty grouping)', () => {
    const a = jobContentKey(null, 'Engineer', 'Build React apps.');
    const b = jobContentKey(null, 'Engineer', 'Build Angular apps.');
    expect(a).not.toBe(b); // body disambiguates when company is absent
    expect(jobContentKey('Acme', null, 'desc')).not.toBeNull();
  });

  it('returns null for fully empty rows (never group unrelated blanks)', () => {
    expect(jobContentKey(null, '', undefined)).toBeNull();
  });
});

describe('partitionByGeneration (ADR 0071, duplicates only within a single day)', () => {
  const row = (id: string, at: string) => ({ id, discovered_at: at });
  const ids = (parts: Array<Array<{ id: string }>>) => parts.map((p) => p.map((r) => r.id).sort()).sort();

  it('keeps a same-day multi-location blast together', () => {
    const parts = partitionByGeneration([
      row('a', '2026-07-11T09:00:00+00:00'),
      row('b', '2026-07-11T09:00:01+00:00'),
      row('c', '2026-07-11T23:59:59+00:00'),
    ]);
    expect(ids(parts)).toEqual([['a', 'b', 'c']]);
  });

  it('splits rows discovered on different days — a next-day repost is a fresh posting', () => {
    const parts = partitionByGeneration([
      row('day1', '2026-07-10T09:00:00+00:00'),
      row('day2', '2026-07-11T09:00:00+00:00'),
    ]);
    expect(ids(parts)).toEqual([['day1'], ['day2']]);
  });

  it('an old opening and a months-later re-post never merge', () => {
    const parts = partitionByGeneration([
      row('march', '2026-03-02T09:00:00+00:00'),
      row('july-a', '2026-07-11T09:00:00+00:00'),
      row('july-b', '2026-07-11T10:00:00+00:00'),
    ]);
    expect(ids(parts)).toEqual([['july-a', 'july-b'], ['march']]);
  });
});

describe('pickCanonical (ADR 0057 addendum)', () => {
  const row = (id: string, location: string | null, fit: number | null, at: string) => ({
    id,
    location,
    fit_score: fit,
    discovered_at: at,
  });
  const prefs = ['Boston, MA', 'New York, NY'];

  it('prefers a Remote variant over everything else', () => {
    const rows = [row('a', 'Cleveland, OH', 7, '2026-01-01'), row('b', 'Remote, United States', null, '2026-01-03')];
    expect(pickCanonical(rows, prefs).id).toBe('b');
  });

  it('prefers a Settings location over an unlisted metro', () => {
    const rows = [row('a', 'Tampa, FL', 7, '2026-01-01'), row('b', 'Boston, MA', null, '2026-01-03')];
    expect(pickCanonical(rows, prefs).id).toBe('b');
  });

  it('at equal location rank, prefers an already-scored row (its score represents the group)', () => {
    const rows = [row('a', 'Tampa, FL', null, '2026-01-01'), row('b', 'Houston, TX', 7, '2026-01-03')];
    expect(pickCanonical(rows, prefs).id).toBe('b');
  });

  it('falls back to earliest when everything ties', () => {
    const rows = [row('b', 'Houston, TX', null, '2026-01-03'), row('a', 'Tampa, FL', null, '2026-01-01')];
    expect(pickCanonical(rows, prefs).id).toBe('a');
  });
});
