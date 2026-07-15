#!/usr/bin/env node

import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const OWNER_USER_ID = '00000000-0000-4000-8000-000000000001';
export const SEED_SOURCE = 'development_seed';

function required(name, env = process.env) {
  const value = (env[name] || '').trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value.replace(/\/$/, '');
}

export function validateTargets(devUrl, prodUrl = '') {
  const dev = new URL(devUrl);
  if (!dev.pathname.endsWith('/jobpilot-dev')) {
    throw new Error('Refusing to seed a target whose URL does not end in /jobpilot-dev.');
  }
  if (prodUrl) {
    const prod = new URL(prodUrl);
    if (!prod.pathname.endsWith('/jobpilot')) {
      throw new Error('Refusing to read keys from a source whose URL does not end in /jobpilot.');
    }
    if (prod.origin === dev.origin && prod.pathname === dev.pathname) {
      throw new Error('Production source and development target must be different.');
    }
  }
}

const tailoredResume = {
  basics: {
    name: 'Development Candidate',
    label: 'Software Engineer',
    email: 'dev-candidate@example.test',
    phone: '',
    location: 'New York, NY',
    summary: 'Synthetic résumé fixture for development-only interface testing.',
  },
  work: [
    {
      name: 'Example Systems',
      position: 'Software Engineer',
      location: 'Remote',
      startDate: '2022-01',
      endDate: '',
      highlights: [
        'Built accessible React and TypeScript applications backed by Node.js APIs.',
        'Improved CI/CD reliability and production observability for distributed services.',
      ],
    },
  ],
  education: [],
  skills: [{ name: 'Engineering', keywords: ['React', 'TypeScript', 'Node.js', 'REST APIs', 'CI/CD'] }],
  projects: [],
  customSections: [],
};

export function syntheticFixtures(now = new Date()) {
  const ago = (hours) => new Date(now.getTime() - hours * 3_600_000).toISOString();
  const jobs = [
    {
      id: '10000000-0000-4000-8000-000000000001',
      user_id: OWNER_USER_ID,
      url: 'development-seed://easy-frontend-engineer',
      application_url: 'https://example.test/jobs/easy-frontend-engineer',
      title: 'Frontend Engineer — Easy Apply Fixture',
      company: 'Development Labs',
      location: 'Remote',
      salary: '$140,000–$170,000',
      full_description: 'Build accessible React and TypeScript interfaces. Required: React, TypeScript, REST APIs, testing, and CI/CD.',
      easy_apply: true,
      fit_score: 8,
      prefilter_score: 68,
      status: 'scored',
      is_shortlisted: true,
      discovered_at: ago(2),
      scored_at: ago(2),
      source: SEED_SOURCE,
      employment_type: 'full_time',
      company_tier: 'good',
      company_tier_note: 'Synthetic development fixture.',
      skill_match_score: 75,
      matched_skills: ['React', 'TypeScript', 'REST APIs'],
      unmatched_skills: ['Playwright'],
    },
    {
      id: '10000000-0000-4000-8000-000000000002',
      user_id: OWNER_USER_ID,
      url: 'development-seed://external-platform-engineer',
      application_url: 'https://example.test/jobs/external-platform-engineer',
      title: 'Platform Engineer — External Apply Fixture',
      company: 'Fixture Cloud',
      location: 'New York, NY',
      salary: '$150,000–$185,000',
      full_description: 'Develop Node.js services and cloud platforms. Required: TypeScript, Node.js, distributed systems, observability, and CI/CD.',
      easy_apply: false,
      fit_score: 7,
      prefilter_score: 54,
      status: 'scored',
      is_shortlisted: true,
      discovered_at: ago(4),
      scored_at: ago(4),
      source: SEED_SOURCE,
      employment_type: 'full_time',
      company_tier: 'medium',
      company_tier_note: 'Synthetic development fixture.',
      skill_match_score: 63,
      matched_skills: ['TypeScript', 'Node.js', 'CI/CD'],
      unmatched_skills: ['Kubernetes'],
    },
    {
      id: '10000000-0000-4000-8000-000000000003',
      user_id: OWNER_USER_ID,
      url: 'development-seed://unknown-apply-fullstack-engineer',
      application_url: 'https://example.test/jobs/fullstack-engineer',
      title: 'Full Stack Engineer — Unknown Source Fixture',
      company: 'Null Metadata Inc.',
      location: 'United States',
      full_description: 'Build React applications and Node.js APIs. Experience with TypeScript, SQL, and cloud deployment is preferred.',
      easy_apply: null,
      fit_score: null,
      prefilter_score: null,
      status: 'unscored',
      is_shortlisted: true,
      discovered_at: ago(6),
      scored_at: null,
      source: SEED_SOURCE,
      employment_type: 'unknown',
    },
    {
      id: '10000000-0000-4000-8000-000000000004',
      user_id: OWNER_USER_ID,
      url: 'development-seed://easy-ui-engineer-applied',
      application_url: 'https://example.test/jobs/ui-engineer',
      title: 'UI Engineer — Applied Fixture',
      company: 'Applied Example Co.',
      location: 'Remote',
      full_description: 'Create reusable accessible UI components with React, TypeScript, design systems, and automated tests.',
      easy_apply: true,
      fit_score: 9,
      prefilter_score: 79,
      status: 'scored',
      is_shortlisted: true,
      discovered_at: ago(8),
      scored_at: ago(8),
      applied_at: ago(1),
      source: SEED_SOURCE,
      employment_type: 'full_time',
      company_tier: 'good',
      company_tier_note: 'Synthetic development fixture.',
    },
    {
      id: '10000000-0000-4000-8000-000000000005',
      user_id: OWNER_USER_ID,
      url: 'development-seed://external-backend-failed',
      application_url: 'https://example.test/jobs/backend-engineer',
      title: 'Backend Engineer — Failed Fixture',
      company: 'Retry Example LLC',
      location: 'Boston, MA',
      full_description: 'Build secure Node.js REST APIs with PostgreSQL, Redis, OAuth, rate limiting, and observability.',
      easy_apply: false,
      fit_score: 6,
      prefilter_score: 48,
      status: 'scored',
      is_shortlisted: true,
      discovered_at: ago(10),
      scored_at: ago(10),
      source: SEED_SOURCE,
      employment_type: 'full_time',
      company_tier: 'medium',
      company_tier_note: 'Synthetic development fixture.',
    },
  ];

  const applications = [
    {
      id: '20000000-0000-4000-8000-000000000001',
      user_id: OWNER_USER_ID,
      job_id: jobs[0].id,
      status: 'queued',
      template: 'classic',
      parked: false,
      created_at: ago(2),
      updated_at: ago(2),
    },
    {
      id: '20000000-0000-4000-8000-000000000002',
      user_id: OWNER_USER_ID,
      job_id: jobs[1].id,
      status: 'ready',
      template: 'modern',
      tailored_resume: tailoredResume,
      base_match_score: 52,
      tailored_match_score: 74,
      tailor_changes: { summary: 'Synthetic tailored résumé fixture.', added_skills: [], title_changes: [], flagged_notes: [] },
      parked: false,
      created_at: ago(4),
      updated_at: ago(1),
    },
    {
      id: '20000000-0000-4000-8000-000000000003',
      user_id: OWNER_USER_ID,
      job_id: jobs[2].id,
      status: 'ready',
      template: 'classic',
      tailored_resume: tailoredResume,
      base_match_score: 61,
      tailored_match_score: 61,
      tailor_changes: { summary: 'Equal-score fixture proves both ATS values remain visible.', added_skills: [], title_changes: [], flagged_notes: [] },
      parked: false,
      created_at: ago(6),
      updated_at: ago(1),
    },
    {
      id: '20000000-0000-4000-8000-000000000004',
      user_id: OWNER_USER_ID,
      job_id: jobs[3].id,
      status: 'applied',
      template: 'classic',
      applied_at: ago(1),
      parked: false,
      created_at: ago(8),
      updated_at: ago(1),
    },
    {
      id: '20000000-0000-4000-8000-000000000005',
      user_id: OWNER_USER_ID,
      job_id: jobs[4].id,
      status: 'failed',
      template: 'classic',
      error: 'Synthetic failure fixture — retry Generate to test recovery.',
      parked: true,
      created_at: ago(10),
      updated_at: ago(1),
    },
  ];

  return { jobs, applications };
}

export function sanitizeOwnerKeys(rows) {
  return rows.map((row) => {
    if (row.user_id !== OWNER_USER_ID) throw new Error('Production key query returned a non-owner row.');
    if (!row.id || !row.provider || !row.key_value) throw new Error('Production key row is incomplete.');
    return {
      id: row.id,
      user_id: OWNER_USER_ID,
      provider: row.provider,
      label: row.label || '',
      key_value: row.key_value,
      is_active: !!row.is_active,
      cooldown_until: row.cooldown_until || null,
      created_at: row.created_at,
    };
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

async function upsert(base, key, table, conflict, rows) {
  // PostgREST rejects a JSON array whose objects have different key sets. Normalize
  // optional fixture fields to explicit nulls so the whole seed remains one atomic batch.
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const normalized = rows.map((row) =>
    Object.fromEntries(columns.map((column) => [
      column,
      Object.prototype.hasOwnProperty.call(row, column) ? row[column] : null,
    ])),
  );
  await api(base, key, `${table}?on_conflict=${encodeURIComponent(conflict)}`, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(normalized),
  });
}

async function seedFixtures(devUrl, devKey) {
  const { jobs, applications } = syntheticFixtures();
  await upsert(devUrl, devKey, 'jobs', 'user_id,url', jobs);
  await upsert(devUrl, devKey, 'applications', 'user_id,job_id', applications);
  return { jobs: jobs.length, applications: applications.length };
}

async function copyOwnerKeys(devUrl, devKey, prodUrl, prodKey) {
  const source = await api(
    prodUrl,
    prodKey,
    'api_keys?select=id,user_id,provider,label,key_value,is_active,cooldown_until,created_at&order=created_at',
  );
  const keys = sanitizeOwnerKeys(source || []);
  const existing = await api(devUrl, devKey, 'api_keys?select=id,user_id');
  const importedIds = new Set(keys.map((row) => row.id));
  const unrelated = (existing || []).filter((row) => !importedIds.has(row.id));
  if (unrelated.length) {
    throw new Error(`Development already has ${unrelated.length} non-imported key row(s); refusing to overwrite their active state.`);
  }

  for (const provider of new Set(keys.map((row) => row.provider))) {
    await api(devUrl, devKey, `api_keys?provider=eq.${encodeURIComponent(provider)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ is_active: false }),
    });
  }
  if (keys.length) await upsert(devUrl, devKey, 'api_keys', 'id', keys);

  const copied = await api(
    devUrl,
    devKey,
    'api_keys?select=id,user_id,provider,label,key_value,is_active,cooldown_until,created_at&order=created_at',
  );
  const targetById = new Map((copied || []).map((row) => [row.id, row]));
  for (const row of keys) {
    const target = targetById.get(row.id);
    if (!target || target.key_value !== row.key_value || target.provider !== row.provider || target.is_active !== row.is_active) {
      throw new Error(`Development key verification failed for imported row ${row.id}.`);
    }
  }
  return keys;
}

async function main() {
  const copyKeys = process.argv.includes('--copy-owner-keys');
  const devUrl = required('DEV_BACKEND_URL');
  const devKey = required('DEV_BACKEND_SERVICE_KEY');
  const prodUrl = copyKeys ? required('PROD_BACKEND_URL') : '';
  const prodKey = copyKeys ? required('PROD_BACKEND_SERVICE_KEY') : '';
  validateTargets(devUrl, prodUrl);

  const seeded = await seedFixtures(devUrl, devKey);
  console.log(`development_seed=complete jobs=${seeded.jobs} applications=${seeded.applications}`);

  if (copyKeys) {
    const keys = await copyOwnerKeys(devUrl, devKey, prodUrl, prodKey);
    const counts = [...new Set(keys.map((row) => row.provider))]
      .sort()
      .map((provider) => `${provider}:${keys.filter((row) => row.provider === provider).length}`)
      .join(',');
    console.log(`owner_keys=complete count=${keys.length} providers=${counts}`);
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(`development_seed=failed ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
