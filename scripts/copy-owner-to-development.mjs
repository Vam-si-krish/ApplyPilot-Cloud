#!/usr/bin/env node

/**
 * Owner-authorized, one-time production → development test-data transfer (ADR 0097).
 *
 * Dry-run is the default. Execution requires --execute. The script talks only to the
 * two existing backend APIs, always supplies the fixed vamsi UUID, never logs profile
 * content or file bytes, and leaves production read-only.
 */
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { OWNER_USER_ID, validateTargets } from './seed-development.mjs';

const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 25;

const PROFILE_FIELDS = [
  'personal',
  'experience',
  'compensation',
  'work_authorization',
  'skills_boundary',
  'candidate_preferences',
  'assistant_profile',
  'resume_text',
  'resume_pdf_path',
  'base_resume',
];

const JOB_FIELDS = [
  'id', 'user_id', 'url', 'title', 'company', 'location', 'salary', 'full_description',
  'application_url', 'easy_apply', 'fit_score', 'prefilter_score', 'prefilter_breakdown',
  'score_note', 'score_keywords', 'score_reasoning', 'score_breakdown', 'employment_type',
  'status', 'is_shortlisted', 'run_id', 'applied_at', 'clicked_at', 'company_size',
  'company_tier', 'company_tier_note', 'tech_stack', 'score_usage', 'skill_match_score',
  'matched_skills', 'unmatched_skills', 'discovered_at', 'scored_at', 'source',
  'content_key', 'duplicate_of',
];

const APPLICATION_FIELDS = [
  'id', 'user_id', 'job_id', 'status', 'template', 'tailored_resume', 'tailor_changes',
  'tailor_instructions', 'tailored_fit_score', 'tailored_score_note', 'tailored_match_score',
  'tailored_match_breakdown', 'base_match_score', 'pdf_path', 'cover_letter',
  'cover_letter_pdf_path', 'cover_letter_error', 'error', 'parked', 'ai_apply_status',
  'ai_assigned_at', 'ai_apply_updated_at', 'ai_block_reason', 'tailor_usage', 'created_at',
  'updated_at', 'applied_at',
];

function required(name, env = process.env) {
  const value = String(env[name] || '').trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value.replace(/\/$/, '');
}

function pick(source, fields) {
  return Object.fromEntries(fields.filter((field) => Object.hasOwn(source, field)).map((field) => [field, source[field]]));
}

function assertOwner(row, label) {
  if (!row || row.user_id !== OWNER_USER_ID) throw new Error(`${label} is not owned by vamsi.`);
}

function targetUrl(job) {
  const raw = job?.application_url || job?.url;
  try {
    const value = new URL(raw);
    return value.protocol === 'http:' || value.protocol === 'https:' ? value.toString() : null;
  } catch {
    return null;
  }
}

export function selectTransferApplications(rows, limit = DEFAULT_LIMIT) {
  const bounded = Math.max(1, Math.min(Number(limit) || DEFAULT_LIMIT, MAX_LIMIT));
  const eligible = rows.filter((application) => {
    assertOwner(application, 'Source application');
    assertOwner(application.job, 'Source job');
    return !application.applied_at && application.status !== 'applied' && targetUrl(application.job);
  });
  return eligible
    .sort((a, b) => {
      const quality = (row) => (row.tailored_resume ? 4 : 0) + (row.pdf_path ? 2 : 0) + (row.status === 'ready' ? 1 : 0);
      return quality(b) - quality(a)
        || new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime();
    })
    .slice(0, bounded);
}

export function sanitizeProfile(source, resumePdfPath) {
  assertOwner(source, 'Source profile');
  return { ...pick(source, PROFILE_FIELDS), resume_pdf_path: resumePdfPath, updated_at: new Date().toISOString() };
}

export function sanitizeJob(source, id) {
  assertOwner(source, 'Source job');
  return {
    ...pick(source, JOB_FIELDS),
    id,
    user_id: OWNER_USER_ID,
    run_id: null,
    duplicate_of: null,
    applied_at: null,
    clicked_at: null,
  };
}

export function sanitizeApplication(source, { id, jobId, pdfPath, coverLetterPdfPath }) {
  assertOwner(source, 'Source application');
  return {
    ...pick(source, APPLICATION_FIELDS),
    id,
    user_id: OWNER_USER_ID,
    job_id: jobId,
    status: source.tailored_resume ? 'ready' : 'queued',
    pdf_path: pdfPath,
    cover_letter_pdf_path: coverLetterPdfPath,
    parked: false,
    ai_apply_status: null,
    ai_assigned_at: null,
    ai_apply_updated_at: null,
    ai_block_reason: null,
    applied_at: null,
    updated_at: new Date().toISOString(),
  };
}

function transferIds(selected, existingJobs, existingApplications) {
  for (const row of existingJobs) assertOwner(row, 'Development job');
  for (const row of existingApplications) assertOwner(row, 'Development application');
  const jobsById = new Map(existingJobs.map((row) => [row.id, row]));
  const jobsByUrl = new Map(existingJobs.map((row) => [row.url, row]));
  const applicationsById = new Map(existingApplications.map((row) => [row.id, row]));
  const applicationsByJob = new Map(existingApplications.map((row) => [row.job_id, row]));
  const usedJobIds = new Set(jobsById.keys());
  const usedApplicationIds = new Set(applicationsById.keys());

  return selected.map((sourceApplication) => {
    const sourceJob = sourceApplication.job;
    const sameJobId = jobsById.get(sourceJob.id);
    const sameUrl = jobsByUrl.get(sourceJob.url);
    const jobId = sameJobId?.url === sourceJob.url ? sourceJob.id
      : sameUrl?.id || (usedJobIds.has(sourceJob.id) ? randomUUID() : sourceJob.id);
    usedJobIds.add(jobId);

    const existingForJob = applicationsByJob.get(jobId);
    const sameApplicationId = applicationsById.get(sourceApplication.id);
    const applicationId = existingForJob?.id
      || (sameApplicationId?.job_id === jobId ? sourceApplication.id
        : usedApplicationIds.has(sourceApplication.id) ? randomUUID() : sourceApplication.id);
    usedApplicationIds.add(applicationId);
    return { sourceApplication, sourceJob, applicationId, jobId };
  });
}

async function api(base, key, resource, init = {}) {
  const response = await fetch(`${base}/rest/v1/${resource}`, {
    ...init,
    headers: {
      apikey: key,
      'x-jobpilot-user-id': OWNER_USER_ID,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  });
  if (!response.ok) {
    const message = (await response.text()).slice(0, 500);
    throw new Error(`${init.method || 'GET'} ${resource.split('?')[0]} failed (${response.status}): ${message}`);
  }
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function upsert(base, key, table, rows) {
  if (!rows.length) return;
  await api(base, key, `${table}?on_conflict=id`, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(rows),
  });
}

function encodedStoragePath(value) {
  if (!value || value.startsWith('/') || value.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error('Unsafe storage object path.');
  }
  return value.split('/').map(encodeURIComponent).join('/');
}

async function downloadStorage(base, key, objectPath) {
  const encoded = encodedStoragePath(objectPath);
  const signed = await fetch(`${base}/storage/v1/object/sign/resumes/${encoded}`, {
    method: 'POST',
    headers: { apikey: key, 'x-jobpilot-user-id': OWNER_USER_ID, 'content-type': 'application/json' },
    body: JSON.stringify({ expiresIn: 60 }),
  });
  if (signed.status === 404) return null;
  if (!signed.ok) throw new Error(`Could not sign source résumé object (${signed.status}).`);
  const payload = await signed.json();
  const response = await fetch(`${base}/storage/v1${payload.signedURL}`);
  if (!response.ok) throw new Error(`Could not download source résumé object (${response.status}).`);
  return Buffer.from(await response.arrayBuffer());
}

async function uploadStorage(base, key, objectPath, bytes) {
  const response = await fetch(`${base}/storage/v1/object/resumes/${encodedStoragePath(objectPath)}`, {
    method: 'POST',
    headers: {
      apikey: key,
      'x-jobpilot-user-id': OWNER_USER_ID,
      'content-type': 'application/pdf',
      'x-upsert': 'true',
    },
    body: bytes,
  });
  if (!response.ok) throw new Error(`Could not upload development résumé object (${response.status}).`);
}

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function copyStorage(prodUrl, prodKey, devUrl, devKey, sourcePath, destinationPath) {
  if (!sourcePath) return null;
  const source = await downloadStorage(prodUrl, prodKey, sourcePath);
  if (!source) return null;
  await uploadStorage(devUrl, devKey, destinationPath, source);
  const copied = await downloadStorage(devUrl, devKey, destinationPath);
  if (!copied || copied.length !== source.length || hash(copied) !== hash(source)) {
    throw new Error('Development résumé object verification failed.');
  }
  return destinationPath;
}

async function buildPlan(prodUrl, prodKey, devUrl, devKey, limit) {
  const [profiles, users, recentApplications, existingJobs, existingApplications] = await Promise.all([
    api(prodUrl, prodKey, `profile?select=user_id,${PROFILE_FIELDS.join(',')}&id=eq.1`),
    api(prodUrl, prodKey, 'app_users?select=id,username,display_name,onboarding_complete&id=eq.' + OWNER_USER_ID),
    api(prodUrl, prodKey, 'applications?select=*,job:jobs(*)&applied_at=is.null&order=updated_at.desc&limit=100'),
    api(devUrl, devKey, 'jobs?select=id,user_id,url'),
    api(devUrl, devKey, 'applications?select=id,user_id,job_id'),
  ]);
  if (profiles?.length !== 1) throw new Error('Production vamsi profile was not found.');
  if (users?.length !== 1 || users[0].id !== OWNER_USER_ID || users[0].username !== 'vamsi') {
    throw new Error('Production fixed vamsi account was not found.');
  }
  const selected = selectTransferApplications(recentApplications || [], limit);
  if (!selected.length) throw new Error('No eligible production applications were found for transfer.');
  return {
    profile: profiles[0],
    user: users[0],
    rows: transferIds(selected, existingJobs || [], existingApplications || []),
  };
}

async function executePlan(plan, prodUrl, prodKey, devUrl, devKey) {
  let copiedFiles = 0;
  let missingFiles = 0;
  const resumePdfPath = await copyStorage(
    prodUrl, prodKey, devUrl, devKey, plan.profile.resume_pdf_path, 'imports/production/base-original.pdf',
  );
  if (plan.profile.resume_pdf_path) resumePdfPath ? copiedFiles++ : missingFiles++;

  const jobs = [];
  const applications = [];
  for (const row of plan.rows) {
    const resumePath = await copyStorage(
      prodUrl, prodKey, devUrl, devKey, row.sourceApplication.pdf_path,
      `imports/production/${row.applicationId}.pdf`,
    );
    const coverPath = await copyStorage(
      prodUrl, prodKey, devUrl, devKey, row.sourceApplication.cover_letter_pdf_path,
      `imports/production/${row.applicationId}-cover.pdf`,
    );
    for (const [source, copied] of [[row.sourceApplication.pdf_path, resumePath], [row.sourceApplication.cover_letter_pdf_path, coverPath]]) {
      if (source) copied ? copiedFiles++ : missingFiles++;
    }
    jobs.push(sanitizeJob(row.sourceJob, row.jobId));
    applications.push(sanitizeApplication(row.sourceApplication, {
      id: row.applicationId,
      jobId: row.jobId,
      pdfPath: resumePath,
      coverLetterPdfPath: coverPath,
    }));
  }

  await upsert(devUrl, devKey, 'jobs', jobs);
  await upsert(devUrl, devKey, 'applications', applications);
  await api(devUrl, devKey, 'profile?id=eq.1', {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(sanitizeProfile(plan.profile, resumePdfPath)),
  });
  await api(devUrl, devKey, `app_users?id=eq.${OWNER_USER_ID}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ display_name: plan.user.display_name || 'Vamsi', onboarding_complete: true, updated_at: new Date().toISOString() }),
  });

  const [verifiedProfile, verifiedApplications] = await Promise.all([
    api(devUrl, devKey, 'profile?select=user_id,base_resume,resume_pdf_path,candidate_preferences&id=eq.1'),
    api(devUrl, devKey, `applications?select=id,user_id,job_id,ai_apply_status,applied_at&id=in.(${applications.map((row) => row.id).join(',')})`),
  ]);
  if (verifiedProfile?.length !== 1 || verifiedProfile[0].user_id !== OWNER_USER_ID
    || !verifiedProfile[0].base_resume || verifiedProfile[0].resume_pdf_path !== resumePdfPath) {
    throw new Error('Development profile verification failed.');
  }
  if (verifiedApplications?.length !== applications.length
    || verifiedApplications.some((row) => row.user_id !== OWNER_USER_ID || row.ai_apply_status || row.applied_at)) {
    throw new Error('Development application verification failed.');
  }
  return { copiedFiles, missingFiles, jobs: jobs.length, applications: applications.length };
}

async function main() {
  const execute = process.argv.includes('--execute');
  const limitArg = process.argv.find((value) => value.startsWith('--limit='));
  const limit = Math.max(1, Math.min(Number(limitArg?.slice('--limit='.length)) || DEFAULT_LIMIT, MAX_LIMIT));
  const devUrl = required('DEV_BACKEND_URL');
  const devKey = required('DEV_BACKEND_SERVICE_KEY');
  const prodUrl = required('PROD_BACKEND_URL');
  const prodKey = required('PROD_BACKEND_SERVICE_KEY');
  validateTargets(devUrl, prodUrl);

  const plan = await buildPlan(prodUrl, prodKey, devUrl, devKey, limit);
  console.log(`owner_dev_transfer=${execute ? 'execute' : 'dry-run'} user=vamsi profile=1 applications=${plan.rows.length} limit=${limit}`);
  if (!execute) return;
  const result = await executePlan(plan, prodUrl, prodKey, devUrl, devKey);
  console.log(`owner_dev_transfer=complete user=vamsi jobs=${result.jobs} applications=${result.applications} files_copied=${result.copiedFiles} files_missing=${result.missingFiles}`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(`owner_dev_transfer=failed ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
