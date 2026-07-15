import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OWNER_USER_ID,
  SEED_SOURCE,
  sanitizeOwnerKeys,
  syntheticFixtures,
  validateTargets,
} from '../scripts/seed-development.mjs';

test('development seed refuses production and arbitrary targets', () => {
  assert.throws(() => validateTargets('https://example.test/jobpilot'), /jobpilot-dev/);
  assert.throws(
    () => validateTargets('https://example.test/jobpilot-dev', 'https://example.test/not-production'),
    /does not end in \/jobpilot/,
  );
  assert.doesNotThrow(() =>
    validateTargets('https://example.test/jobpilot-dev', 'https://example.test/jobpilot'),
  );
});

test('development fixtures are synthetic and remain owner-scoped', () => {
  const { jobs, applications } = syntheticFixtures(new Date('2026-07-15T00:00:00Z'));
  assert.equal(jobs.length, 5);
  assert.equal(applications.length, 5);
  assert.ok(jobs.every((row) => row.user_id === OWNER_USER_ID && row.source === SEED_SOURCE));
  assert.ok(jobs.every((row) => row.url.startsWith('development-seed://')));
  assert.ok(applications.every((row) => row.user_id === OWNER_USER_ID));
  assert.deepEqual(new Set(jobs.map((row) => row.easy_apply)), new Set([true, false, null]));
  assert.ok(applications.some((row) => row.base_match_score === row.tailored_match_score));
  assert.ok(jobs.some((row) => !Object.prototype.hasOwnProperty.call(row, 'salary')));
});

test('owner key import strips extra fields and rejects another user', () => {
  const rows = sanitizeOwnerKeys([
    {
      id: 'key-1',
      user_id: OWNER_USER_ID,
      provider: 'openai',
      label: 'owner',
      key_value: 'secret',
      is_active: true,
      cooldown_until: null,
      created_at: '2026-07-15T00:00:00Z',
      unexpected: 'not copied',
    },
  ]);
  assert.equal(rows[0].unexpected, undefined);
  assert.throws(
    () => sanitizeOwnerKeys([{ ...rows[0], user_id: '00000000-0000-4000-8000-000000000002' }]),
    /non-owner/,
  );
});
