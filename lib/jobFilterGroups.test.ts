import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { duplicatePassesHideFilters, promoteVisibleDuplicateGroups } from './jobFilterGroups';

const jobsPage = readFileSync(fileURLToPath(new URL('../app/(app)/jobs/page.tsx', import.meta.url)), 'utf8');

describe('Jobs hide filters across duplicate groups', () => {
  it('enables the applied and Tailor & Apply hide filters on first load', () => {
    expect(jobsPage).toContain('const [hideApplied, setHideApplied] = useState(true)');
    expect(jobsPage).toContain('const [hideInApplications, setHideInApplications] = useState(true)');
  });

  it('promotes one visible location when the canonical job is hidden', () => {
    const result = promoteVisibleDuplicateGroups(
      [
        { id: 'location-a', duplicate_of: 'canonical' },
        { id: 'location-b', duplicate_of: 'canonical' },
        { id: 'other', duplicate_of: null },
      ],
      new Set(['canonical']),
    );

    expect(result.rows).toEqual([
      { id: 'location-a', duplicate_of: null },
      { id: 'other', duplicate_of: null },
    ]);
    expect(result.canonicalGroupByRepresentative.get('location-a')).toBe('canonical');
    expect(result.collapsedCount).toBe(1);
  });

  it('does not collapse ordinary rows or duplicate groups whose canonical remains visible', () => {
    const rows = [
      { id: 'canonical', duplicate_of: null },
      { id: 'location-a', duplicate_of: 'canonical' },
    ];
    expect(promoteVisibleDuplicateGroups(rows, new Set()).rows).toEqual(rows);
  });

  it('applies both hide rules to locations attached beneath a visible row', () => {
    const applicationJobIds = new Set(['tailored']);
    const options = { excludeApplied: true, excludeInApplications: true, applicationJobIds };

    expect(duplicatePassesHideFilters({ id: 'available', applied_at: null }, options)).toBe(true);
    expect(duplicatePassesHideFilters({ id: 'tailored', applied_at: null }, options)).toBe(false);
    expect(duplicatePassesHideFilters({ id: 'applied', applied_at: '2026-07-16T00:00:00Z' }, options)).toBe(false);
  });
});
