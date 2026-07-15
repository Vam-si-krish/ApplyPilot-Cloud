import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveCandidatePreferences, normalizeSourceJob } from './scripts/migrate-owner-from-production.mjs';

test('owner migration maps only explicit legacy application answers', () => {
  const result = deriveCandidatePreferences({
    compensation: { salary_currency: 'USD' },
    assistant_profile: {
      availability: {
        willing_to_relocate: false,
        earliest_start_date: '2026-08-01',
        notice_period: 'Two weeks',
        relocation_notes: 'Remote preferred',
      },
      job_preferences: {
        open_to_remote: true,
        open_to_hybrid: true,
        open_to_onsite: false,
        open_to_full_time: true,
        open_to_contract: false,
        open_to_w2: true,
        notes: 'No travel above 20%',
      },
      compensation: { salary_expectation: '$100,000+' },
    },
  });

  assert.deepEqual(result, {
    application_answers: {
      willing_to_relocate: false,
      preferred_work_arrangement: 'Remote, Hybrid',
      available_start: 'Earliest start: 2026-08-01; Notice period: Two weeks',
      employment_types: 'Full-time, W-2',
      salary_expectation: '$100,000+',
      additional_facts: 'Remote preferred\nNo travel above 20%',
    },
  });
  assert.equal(result.avoid_security_clearance_jobs, undefined);
});

test('owner migration never fabricates a score for legacy scored rows without one', () => {
  assert.deepEqual(
    normalizeSourceJob({ id: 'job', status: 'scored', fit_score: null, scored_at: '2026-07-01' }),
    { id: 'job', status: 'unscored', fit_score: null, scored_at: null },
  );
  assert.deepEqual(
    normalizeSourceJob({ id: 'job', status: 'scored', fit_score: 8, scored_at: '2026-07-01' }),
    { id: 'job', status: 'scored', fit_score: 8, scored_at: '2026-07-01' },
  );
});
