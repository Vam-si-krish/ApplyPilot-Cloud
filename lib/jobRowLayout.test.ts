import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const jobsPage = readFileSync(
  fileURLToPath(new URL('../app/(app)/jobs/page.tsx', import.meta.url)),
  'utf8',
);

describe('Jobs row layout contract', () => {
  it('keeps every desktop metadata field in a stable grid cell', () => {
    const gridStart = jobsPage.indexOf('grid-cols-[4.5rem_5.5rem_5.5rem_7.5rem_3.75rem_3.75rem_4.25rem]');
    const railStart = jobsPage.indexOf('w-[9.25rem] shrink-0');

    expect(gridStart).toBeGreaterThan(-1);
    expect(railStart).toBeGreaterThan(gridStart);

    const metadataGrid = jobsPage.slice(gridStart, railStart);
    for (const field of [
      'job.employment_type',
      'job.easy_apply',
      'job.company_tier',
      'job.siblings',
      'job.prefilter_score',
      'job.skill_match_score',
      'job.clicked_at',
    ]) {
      expect(metadataGrid).toContain(field);
    }
  });

  it('removes the inline fit-note paragraph and reserves all action positions', () => {
    expect(jobsPage).toContain('fitScoreTooltip(job.fit_score, job.score_note)');
    expect(jobsPage).not.toMatch(/<p[^>]*>\{job\.score_note\}<\/p>/);
    expect(jobsPage).toContain('aria-hidden="true" className="h-[23px] w-[23px] shrink-0"');
  });
});
