#!/usr/bin/env node

/**
 * Recover explicit Easy Apply / External metadata from the Apify datasets that originally
 * produced a user's jobs. Dry-run is the default; pass --execute to update only NULL rows.
 *
 * This intentionally does not infer application type from a LinkedIn URL. It writes only
 * an actor-provided boolean or applyType/applicationType label so historical metadata is
 * never fabricated.
 */
import pg from 'pg';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const { Client } = pg;
const DEFAULT_TARGET_USER_ID = '00000000-0000-4000-8000-000000000001';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const URL_KEYS = ['url', 'jobUrl', 'link', 'jobPostingUrl', 'job_url'];
const BOOLEAN_KEYS = ['easyApply', 'isEasyApply', 'easy_apply', 'isEasyApplyJob'];

function firstString(item, keys) {
  for (const key of keys) {
    const value = item?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

/** Return only an application type the actor stated explicitly. */
export function explicitEasyApply(item) {
  for (const key of BOOLEAN_KEYS) {
    if (typeof item?.[key] === 'boolean') return item[key];
  }
  const type = firstString(item, ['applyType', 'applicationType']);
  if (!type) return null;
  if (/easy[ _-]?apply/i.test(type)) return true;
  if (/external/i.test(type)) return false;
  return null;
}

export function datasetJobUrl(item) {
  return firstString(item, URL_KEYS);
}

function requiredEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function databaseClient(password) {
  return new Client({
    host: process.env.LOCAL_POSTGRES_HOST || '127.0.0.1',
    port: Number(process.env.LOCAL_POSTGRES_PORT || 54322),
    user: process.env.LOCAL_POSTGRES_USER || 'postgres',
    password,
    database: process.env.DESTINATION_DB_NAME || 'jobpilot_multi',
  });
}

async function apifyJson(path, token) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(`https://api.apify.com/v2/${path}`, {
      headers: { authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    if (!response.ok) return { status: response.status, value: null };
    return { status: response.status, value: await response.json() };
  } finally {
    clearTimeout(timeout);
  }
}

async function findRun(runId, tokens, preferredTokenIndex) {
  const order = [...tokens.keys()];
  if (preferredTokenIndex >= 0) {
    order.splice(order.indexOf(preferredTokenIndex), 1);
    order.unshift(preferredTokenIndex);
  }
  for (const tokenIndex of order) {
    const result = await apifyJson(`actor-runs/${encodeURIComponent(runId)}`, tokens[tokenIndex]);
    if (result.status === 200 && result.value?.data) {
      return { run: result.value.data, tokenIndex };
    }
    if (![401, 403, 404].includes(result.status)) {
      throw new Error(`Apify run lookup failed with HTTP ${result.status}`);
    }
  }
  return null;
}

async function datasetItems(datasetId, token) {
  const items = [];
  for (let offset = 0; ; offset += 1000) {
    const result = await apifyJson(
      `datasets/${encodeURIComponent(datasetId)}/items?clean=true&format=json&limit=1000&offset=${offset}`,
      token,
    );
    if (result.status !== 200 || !Array.isArray(result.value)) {
      throw new Error(`Apify dataset lookup failed with HTTP ${result.status}`);
    }
    items.push(...result.value);
    if (result.value.length < 1000) return items;
  }
}

async function backfill({ execute, targetUserId }) {
  if (!UUID.test(targetUserId)) throw new Error('Target user ID must be a UUID');
  const db = databaseClient(requiredEnv('LOCAL_POSTGRES_PASSWORD'));
  await db.connect();
  try {
    const userResult = await db.query('select username from app_users where id=$1', [targetUserId]);
    if (userResult.rowCount !== 1) throw new Error('Target app user does not exist');

    const keyResult = await db.query(
      `select key_value from api_keys
        where user_id=$1 and provider='apify'
        order by is_active desc, created_at desc`,
      [targetUserId],
    );
    const tokens = keyResult.rows.map((row) => String(row.key_value || '').trim()).filter(Boolean);
    if (!tokens.length) throw new Error('Target user has no Apify keys');

    const runResult = await db.query(
      `select id, apify_run_id from runs
        where user_id=$1 and apify_run_id is not null
        order by started_at desc`,
      [targetUserId],
    );
    const jobResult = await db.query(
      `select id, run_id, url from jobs
        where user_id=$1 and easy_apply is null and source like 'apify:%'`,
      [targetUserId],
    );

    const jobsByRun = new Map();
    for (const job of jobResult.rows) {
      if (!job.run_id) continue;
      if (!jobsByRun.has(job.run_id)) jobsByRun.set(job.run_id, new Map());
      jobsByRun.get(job.run_id).set(job.url, job.id);
    }

    const updates = new Map();
    const conflicts = new Set();
    let accessibleRuns = 0;
    let inaccessibleRuns = 0;
    let datasetsWithoutId = 0;
    let explicitItems = 0;
    let unmatchedItems = 0;
    let preferredTokenIndex = -1;

    for (const row of runResult.rows) {
      const runJobs = jobsByRun.get(row.id);
      if (!runJobs?.size) continue;
      const found = await findRun(row.apify_run_id, tokens, preferredTokenIndex);
      if (!found) {
        inaccessibleRuns += 1;
        continue;
      }
      accessibleRuns += 1;
      preferredTokenIndex = found.tokenIndex;
      const datasetId = String(found.run.defaultDatasetId || '').trim();
      if (!datasetId) {
        datasetsWithoutId += 1;
        continue;
      }
      const items = await datasetItems(datasetId, tokens[found.tokenIndex]);
      for (const item of items) {
        const easyApply = explicitEasyApply(item);
        if (easyApply === null) continue;
        explicitItems += 1;
        const url = datasetJobUrl(item);
        const jobId = url ? runJobs.get(url) : null;
        if (!jobId) {
          unmatchedItems += 1;
          continue;
        }
        if (updates.has(jobId) && updates.get(jobId) !== easyApply) {
          updates.delete(jobId);
          conflicts.add(jobId);
        } else if (!conflicts.has(jobId)) {
          updates.set(jobId, easyApply);
        }
      }
    }

    const summary = {
      mode: execute ? 'execute' : 'dry-run',
      target: userResult.rows[0].username,
      unknownApifyJobs: jobResult.rowCount,
      runsWithUnknownJobs: jobsByRun.size,
      accessibleRuns,
      inaccessibleRuns,
      datasetsWithoutId,
      explicitDatasetItems: explicitItems,
      matchedJobs: updates.size,
      unmatchedExplicitItems: unmatchedItems,
      conflictingJobsSkipped: conflicts.size,
    };

    if (execute && updates.size) {
      await db.query('begin');
      try {
        let changed = 0;
        for (const [jobId, easyApply] of updates) {
          const result = await db.query(
            `update jobs set easy_apply=$1
              where user_id=$2 and id=$3 and easy_apply is null`,
            [easyApply, targetUserId, jobId],
          );
          changed += result.rowCount;
        }
        await db.query('commit');
        summary.updatedJobs = changed;
      } catch (error) {
        await db.query('rollback');
        throw error;
      }
    }

    console.log(JSON.stringify(summary));
  } finally {
    await db.end();
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const execute = process.argv.includes('--execute');
  const targetArg = process.argv.find((value) => value.startsWith('--target-user='));
  const targetUserId = targetArg ? targetArg.slice('--target-user='.length) : DEFAULT_TARGET_USER_ID;
  backfill({ execute, targetUserId }).catch((error) => {
    console.error(`Easy Apply backfill failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
