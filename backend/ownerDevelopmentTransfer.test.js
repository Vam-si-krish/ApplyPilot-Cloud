import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeApplication,
  sanitizeJob,
  sanitizeProfile,
  selectTransferApplications,
} from '../scripts/copy-owner-to-development.mjs';
import { OWNER_USER_ID } from '../scripts/seed-development.mjs';

function source(overrides = {}) {
  const job = {
    id: '10000000-0000-4000-8000-000000000001',
    user_id: OWNER_USER_ID,
    url: 'https://jobs.example.test/1',
    application_url: 'https://apply.example.test/1',
    title: 'Engineer',
    company: 'Example',
    run_id: '20000000-0000-4000-8000-000000000001',
    duplicate_of: '30000000-0000-4000-8000-000000000001',
    applied_at: null,
    clicked_at: '2026-07-15T00:00:00Z',
  };
  return {
    id: '40000000-0000-4000-8000-000000000001',
    user_id: OWNER_USER_ID,
    job_id: job.id,
    status: 'ready',
    tailored_resume: { basics: { name: 'Private candidate' } },
    pdf_path: 'source.pdf',
    cover_letter_pdf_path: 'source-cover.pdf',
    ai_apply_status: 'in_progress',
    ai_assigned_at: '2026-07-15T00:00:00Z',
    parked: true,
    applied_at: null,
    updated_at: '2026-07-15T01:00:00Z',
    job,
    ...overrides,
  };
}

test('owner development transfer selects linked, unapplied rows and prefers prepared applications', () => {
  const selected = selectTransferApplications([
    source({ id: 'newer-unprepared', tailored_resume: null, pdf_path: null, status: 'queued', updated_at: '2026-07-15T03:00:00Z' }),
    source({ id: 'prepared' }),
    source({ id: 'applied', status: 'applied', applied_at: '2026-07-15T02:00:00Z' }),
  ], 2);
  assert.deepEqual(selected.map((row) => row.id), ['prepared', 'newer-unprepared']);
});

test('owner development transfer strips relationships and resets operational state', () => {
  const row = source();
  const job = sanitizeJob(row.job, row.job.id);
  const application = sanitizeApplication(row, {
    id: row.id,
    jobId: job.id,
    pdfPath: 'imports/production/resume.pdf',
    coverLetterPdfPath: 'imports/production/cover.pdf',
  });
  assert.equal(job.run_id, null);
  assert.equal(job.duplicate_of, null);
  assert.equal(job.clicked_at, null);
  assert.equal(application.status, 'ready');
  assert.equal(application.ai_apply_status, null);
  assert.equal(application.ai_assigned_at, null);
  assert.equal(application.parked, false);
  assert.equal(application.applied_at, null);
  assert.equal(application.pdf_path, 'imports/production/resume.pdf');
});

test('owner development transfer refuses another user and copies only profile fields', () => {
  assert.throws(() => selectTransferApplications([
    source({ user_id: '00000000-0000-4000-8000-000000000002' }),
  ]), /not owned by vamsi/);
  const profile = sanitizeProfile({
    user_id: OWNER_USER_ID,
    personal: { full_name: 'Private candidate' },
    base_resume: { basics: { name: 'Private candidate' } },
    resume_pdf_path: 'source.pdf',
    api_keys: ['must not copy'],
  }, 'imports/production/base-original.pdf');
  assert.equal(profile.api_keys, undefined);
  assert.equal(profile.resume_pdf_path, 'imports/production/base-original.pdf');
  assert.deepEqual(profile.base_resume, { basics: { name: 'Private candidate' } });
});
