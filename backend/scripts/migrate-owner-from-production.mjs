#!/usr/bin/env node

/**
 * One-time, explicit owner migration from the original `postgres` database into one
 * empty fixed account in `jobpilot_multi` (ADR 0087).
 *
 * Dry-run is the default. Execution requires:
 *
 *   LOCAL_POSTGRES_PASSWORD=... \
 *   SOURCE_STORAGE_ROOT=/path/to/copied/supabase/storage/root \
 *   DESTINATION_STORAGE_ROOT=/path/to/jobpilot-multi/backend/data \
 *   node backend/scripts/migrate-owner-from-production.mjs --execute
 *
 * The script never prints profile content or credentials. It copies source rows into a
 * single UUID, preserves IDs/relationships, namespaces files under that UUID, and leaves
 * the source database/storage untouched.
 */
import pg from 'pg';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const { Client } = pg;
const DEFAULT_TARGET_USER_ID = '00000000-0000-4000-8000-000000000001';
const HISTORY_TABLES = ['api_keys', 'runs', 'jobs', 'applications', 'mail_messages'];
const SINGLETON_TABLES = ['profile', 'settings', 'gmail_connection', 'scoring_state'];
const COPY_ORDER = ['api_keys', 'runs', 'jobs', 'applications', 'mail_messages', ...SINGLETON_TABLES];
const NEVER_COPY_SETTINGS = new Set(['resume_worker_url', 'resume_worker_secret']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requiredEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function text(value, max = 4000) {
  if (value == null) return '';
  const result = String(value).trim();
  return result.slice(0, max);
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

/** Map only explicit legacy ApplyBuddy answers into the new Candidate Profile fields. */
export function deriveCandidatePreferences(profile = {}) {
  const assistant = object(profile.assistant_profile);
  const availability = object(assistant.availability);
  const jobs = object(assistant.job_preferences);
  const compensation = { ...object(profile.compensation), ...object(assistant.compensation) };
  const answers = {};

  if (typeof availability.willing_to_relocate === 'boolean') {
    answers.willing_to_relocate = availability.willing_to_relocate;
  }

  const arrangements = [
    jobs.open_to_remote === true ? 'Remote' : '',
    jobs.open_to_hybrid === true ? 'Hybrid' : '',
    jobs.open_to_onsite === true ? 'On-site' : '',
  ].filter(Boolean);
  if (arrangements.length) answers.preferred_work_arrangement = arrangements.join(', ');

  const start = [
    text(availability.earliest_start_date, 200) ? `Earliest start: ${text(availability.earliest_start_date, 200)}` : '',
    text(availability.notice_period, 200) ? `Notice period: ${text(availability.notice_period, 200)}` : '',
  ].filter(Boolean);
  if (start.length) answers.available_start = start.join('; ');

  const employmentTypes = [
    jobs.open_to_full_time === true ? 'Full-time' : '',
    jobs.open_to_contract === true ? 'Contract' : '',
    jobs.open_to_w2 === true ? 'W-2' : '',
    jobs.open_to_corp_to_corp === true ? 'C2C' : '',
  ].filter(Boolean);
  if (employmentTypes.length) answers.employment_types = employmentTypes.join(', ');

  const salary = text(compensation.salary_expectation, 500);
  const salaryRange = [compensation.salary_range_min, compensation.salary_range_max]
    .filter((value) => value != null && String(value).trim())
    .map(String)
    .join('–');
  if (salary || salaryRange) {
    answers.salary_expectation = salary || `${salaryRange}${text(compensation.salary_currency, 20) ? ` ${text(compensation.salary_currency, 20)}` : ''}`;
  }

  const notes = [text(availability.relocation_notes, 2000), text(jobs.notes, 2000)].filter(Boolean);
  if (notes.length) answers.additional_facts = notes.join('\n');
  return Object.keys(answers).length ? { application_answers: answers } : {};
}

/** Preserve the scored/result invariant without inventing a numeric score. */
export function normalizeSourceJob(row) {
  if (row.status === 'scored' && row.fit_score == null) {
    return { ...row, status: 'unscored', scored_at: null };
  }
  return row;
}

function safeStoragePart(value, label) {
  const raw = String(value || '');
  const cleaned = normalize(raw);
  if (!raw || raw.startsWith('/') || cleaned === '..' || cleaned.startsWith(`..${sep}`)) {
    throw new Error(`Unsafe ${label}: ${raw}`);
  }
  return cleaned;
}

async function sha256(path) {
  const hash = createHash('sha256');
  hash.update(await readFile(path));
  return hash.digest('hex');
}

function client(database, password) {
  return new Client({
    host: process.env.LOCAL_POSTGRES_HOST || '127.0.0.1',
    port: Number(process.env.LOCAL_POSTGRES_PORT || 54322),
    user: process.env.LOCAL_POSTGRES_USER || 'postgres',
    password,
    database,
  });
}

async function tableColumns(db, table) {
  const result = await db.query(
    `select column_name
       from information_schema.columns
      where table_schema = 'public' and table_name = $1 and is_generated = 'NEVER'
      order by ordinal_position`,
    [table],
  );
  return result.rows.map((row) => row.column_name);
}

function quoteIdent(value) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value)) throw new Error(`Unsafe SQL identifier: ${value}`);
  return `"${value}"`;
}

async function insertRows(db, table, rows, destinationColumns) {
  if (!rows.length) return;
  const columns = destinationColumns.filter((column) => Object.hasOwn(rows[0], column));
  const quotedColumns = columns.map(quoteIdent).join(', ');
  const batchSize = table === 'jobs' || table === 'mail_messages' ? 100 : 200;
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize);
    const values = [];
    const tuples = batch.map((row) => {
      const tuple = columns.map((column) => {
        values.push(row[column]);
        return `$${values.length}`;
      });
      return `(${tuple.join(', ')})`;
    });
    await db.query(`insert into ${quoteIdent(table)} (${quotedColumns}) values ${tuples.join(', ')}`, values);
  }
}

async function assertNoIdCollisions(destination, table, rows) {
  if (!rows.length || !Object.hasOwn(rows[0], 'id') || table === 'profile' || table === 'settings' || table === 'gmail_connection' || table === 'scoring_state') return;
  const ids = rows.map((row) => row.id);
  const result = await destination.query(`select count(*)::int count from ${quoteIdent(table)} where id = any($1::uuid[])`, [ids]);
  if (result.rows[0].count) throw new Error(`${table} has ${result.rows[0].count} destination ID collision(s)`);
}

async function targetInventory(destination, userId) {
  const inventory = {};
  for (const table of [...HISTORY_TABLES, ...SINGLETON_TABLES]) {
    const result = await destination.query(`select count(*)::int count from ${quoteIdent(table)} where user_id = $1`, [userId]);
    inventory[table] = result.rows[0].count;
  }
  return inventory;
}

async function sourceInventory(source) {
  const inventory = {};
  for (const table of COPY_ORDER) {
    const result = await source.query(`select count(*)::int count from ${quoteIdent(table)}`);
    inventory[table] = result.rows[0].count;
  }
  const files = await source.query("select count(*)::int count, coalesce(sum((metadata->>'size')::bigint), 0)::text bytes from storage.objects where bucket_id = 'resumes'");
  inventory.storage_objects = files.rows[0].count;
  inventory.storage_bytes = files.rows[0].bytes;
  return inventory;
}

async function prepareFiles(source, sourceRoot, destinationRoot, userId) {
  const finalRoot = join(destinationRoot, userId);
  if (existsSync(finalRoot)) {
    const contents = await readdir(finalRoot);
    if (contents.length) throw new Error(`Destination file namespace is not empty: ${finalRoot}`);
    await rm(finalRoot, { recursive: true });
  }
  const temporaryRoot = join(destinationRoot, `.${userId}.owner-migration-${process.pid}`);
  await rm(temporaryRoot, { recursive: true, force: true });
  await mkdir(temporaryRoot, { recursive: true, mode: 0o700 });

  const objects = await source.query(
    "select bucket_id, name, version, (metadata->>'size')::bigint size from storage.objects where bucket_id = 'resumes' order by name",
  );
  let bytes = 0;
  try {
    for (const entry of objects.rows) {
      const bucket = safeStoragePart(entry.bucket_id, 'bucket');
      const name = safeStoragePart(entry.name, 'object name');
      const version = safeStoragePart(entry.version, 'object version');
      const sourceFile = join(sourceRoot, 'stub', 'stub', bucket, name, version);
      const destinationFile = join(temporaryRoot, bucket, name);
      const sourceInfo = await stat(sourceFile);
      if (!sourceInfo.isFile()) throw new Error(`Source object is not a file: ${name}`);
      if (entry.size != null && Number(entry.size) !== sourceInfo.size) {
        throw new Error(`Source object size mismatch: ${name}`);
      }
      await mkdir(dirname(destinationFile), { recursive: true, mode: 0o700 });
      await copyFile(sourceFile, destinationFile);
      const destinationInfo = await stat(destinationFile);
      if (destinationInfo.size !== sourceInfo.size || (await sha256(destinationFile)) !== (await sha256(sourceFile))) {
        throw new Error(`Copied object verification failed: ${name}`);
      }
      bytes += sourceInfo.size;
    }
    return { temporaryRoot, finalRoot, count: objects.rows.length, bytes };
  } catch (error) {
    await rm(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
}

async function migrate({ execute, targetUserId }) {
  if (!UUID.test(targetUserId)) throw new Error('Target user ID must be a UUID');
  const password = requiredEnv('LOCAL_POSTGRES_PASSWORD');
  const sourceDatabase = process.env.SOURCE_DB_NAME || 'postgres';
  const destinationDatabase = process.env.DESTINATION_DB_NAME || 'jobpilot_multi';
  if (sourceDatabase === destinationDatabase) throw new Error('Source and destination databases must differ');

  const source = client(sourceDatabase, password);
  const destination = client(destinationDatabase, password);
  await Promise.all([source.connect(), destination.connect()]);
  await source.query('begin isolation level repeatable read read only');
  let sourceTransactionOpen = true;
  let preparedFiles = null;
  try {
    const user = await destination.query('select username, onboarding_complete from app_users where id = $1', [targetUserId]);
    if (user.rowCount !== 1) throw new Error('Target app user does not exist');
    const [sourceCounts, targetCounts] = await Promise.all([sourceInventory(source), targetInventory(destination, targetUserId)]);
    for (const table of HISTORY_TABLES) {
      if (targetCounts[table] !== 0) throw new Error(`Target ${user.rows[0].username} account is not empty: ${table}=${targetCounts[table]}`);
    }

    const scoredWithoutResult = await source.query("select count(*)::int count from jobs where status = 'scored' and fit_score is null");
    console.log(JSON.stringify({
      mode: execute ? 'execute' : 'dry-run',
      target: { username: user.rows[0].username, userId: targetUserId },
      source: sourceCounts,
      targetBefore: targetCounts,
      normalizations: { scoredWithoutNumericResultToUnscored: scoredWithoutResult.rows[0].count },
    }));
    if (!execute) return;

    const sourceStorageRoot = resolve(requiredEnv('SOURCE_STORAGE_ROOT'));
    const destinationStorageRoot = resolve(requiredEnv('DESTINATION_STORAGE_ROOT'));
    preparedFiles = await prepareFiles(source, sourceStorageRoot, destinationStorageRoot, targetUserId);

    const rowsByTable = {};
    for (const table of COPY_ORDER) {
      rowsByTable[table] = (await source.query(`select * from ${quoteIdent(table)}`)).rows;
      await assertNoIdCollisions(destination, table, rowsByTable[table]);
    }

    const legacyProfile = rowsByTable.profile[0] || {};
    rowsByTable.profile = rowsByTable.profile.map((row) => ({
      ...row,
      candidate_preferences: deriveCandidatePreferences(row),
      user_id: targetUserId,
    }));
    rowsByTable.settings = rowsByTable.settings.map((row) => {
      const mapped = { ...row, user_id: targetUserId };
      for (const field of NEVER_COPY_SETTINGS) delete mapped[field];
      return mapped;
    });
    rowsByTable.gmail_connection = rowsByTable.gmail_connection.map((row) => ({ ...row, user_id: targetUserId }));
    rowsByTable.scoring_state = rowsByTable.scoring_state.map((row) => ({ ...row, user_id: targetUserId, active: false, stop_requested: false, rescan_requested: false }));
    rowsByTable.api_keys = rowsByTable.api_keys.map((row) => ({ ...row, user_id: targetUserId }));
    rowsByTable.runs = rowsByTable.runs.map((row) => ({ ...row, user_id: targetUserId, apify_api_key_id: null }));
    const duplicateLinks = rowsByTable.jobs.filter((row) => row.duplicate_of).map((row) => ({ id: row.id, duplicate_of: row.duplicate_of }));
    rowsByTable.jobs = rowsByTable.jobs.map((row) => ({ ...normalizeSourceJob(row), duplicate_of: null, user_id: targetUserId }));
    rowsByTable.applications = rowsByTable.applications.map((row) => ({ ...row, user_id: targetUserId }));
    rowsByTable.mail_messages = rowsByTable.mail_messages.map((row) => ({ ...row, user_id: targetUserId }));

    await destination.query('begin');
    let filesPromoted = false;
    try {
      for (const table of [...SINGLETON_TABLES].reverse()) {
        await destination.query(`delete from ${quoteIdent(table)} where user_id = $1`, [targetUserId]);
      }
      for (const table of COPY_ORDER) {
        const columns = await tableColumns(destination, table);
        await insertRows(destination, table, rowsByTable[table], columns);
      }
      for (let offset = 0; offset < duplicateLinks.length; offset += 200) {
        const batch = duplicateLinks.slice(offset, offset + 200);
        const values = [];
        const tuples = batch.map((link) => {
          values.push(link.id, link.duplicate_of);
          return `($${values.length - 1}::uuid, $${values.length}::uuid)`;
        });
        await destination.query(
          `update jobs j set duplicate_of = v.duplicate_of
             from (values ${tuples.join(', ')}) as v(id, duplicate_of)
            where j.user_id = $${values.length + 1} and j.id = v.id`,
          [...values, targetUserId],
        );
      }

      const displayName = text(object(legacyProfile.personal).preferred_name, 120) || text(object(legacyProfile.personal).full_name, 120) || 'Vamsi';
      await destination.query(
        'update app_users set display_name = $1, onboarding_complete = true, updated_at = now() where id = $2',
        [displayName, targetUserId],
      );

      for (const table of COPY_ORDER) {
        const count = await destination.query(`select count(*)::int count from ${quoteIdent(table)} where user_id = $1`, [targetUserId]);
        if (count.rows[0].count !== rowsByTable[table].length) {
          throw new Error(`${table} verification failed: expected ${rowsByTable[table].length}, got ${count.rows[0].count}`);
        }
      }
      const brokenRelationships = await destination.query(
        `select
           (select count(*)::int from applications a left join jobs j on j.user_id=a.user_id and j.id=a.job_id where a.user_id=$1 and j.id is null) orphan_applications,
           (select count(*)::int from jobs j left join runs r on r.user_id=j.user_id and r.id=j.run_id where j.user_id=$1 and j.run_id is not null and r.id is null) orphan_runs,
           (select count(*)::int from jobs j left join jobs p on p.user_id=j.user_id and p.id=j.duplicate_of where j.user_id=$1 and j.duplicate_of is not null and p.id is null) orphan_duplicates`,
        [targetUserId],
      );
      if (Object.values(brokenRelationships.rows[0]).some((value) => Number(value) !== 0)) {
        throw new Error(`Relationship verification failed: ${JSON.stringify(brokenRelationships.rows[0])}`);
      }
      // Promote the already-verified file tree while the database transaction can still
      // roll back. The rename is atomic because staging and final roots share a volume.
      await rename(preparedFiles.temporaryRoot, preparedFiles.finalRoot);
      filesPromoted = true;
      await destination.query('commit');
    } catch (error) {
      await destination.query('rollback');
      if (filesPromoted) {
        await rename(preparedFiles.finalRoot, preparedFiles.temporaryRoot).catch(() => {});
      }
      throw error;
    }

    const finalCounts = await targetInventory(destination, targetUserId);
    console.log(JSON.stringify({
      migrated: true,
      target: { username: user.rows[0].username, userId: targetUserId, onboardingComplete: true },
      rows: finalCounts,
      files: { count: preparedFiles.count, bytes: preparedFiles.bytes },
      excludedDeploymentFields: [...NEVER_COPY_SETTINGS],
    }));
    await source.query('commit');
    sourceTransactionOpen = false;
    preparedFiles = null;
  } finally {
    if (preparedFiles?.temporaryRoot) await rm(preparedFiles.temporaryRoot, { recursive: true, force: true });
    if (sourceTransactionOpen) await source.query('rollback').catch(() => {});
    await Promise.allSettled([source.end(), destination.end()]);
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const execute = process.argv.includes('--execute');
  const targetArg = process.argv.find((value) => value.startsWith('--target-user='));
  const targetUserId = targetArg ? targetArg.slice('--target-user='.length) : DEFAULT_TARGET_USER_ID;
  migrate({ execute, targetUserId }).catch((error) => {
    console.error(`Owner migration failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
