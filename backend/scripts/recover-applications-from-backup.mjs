#!/usr/bin/env node
/**
 * Restore a bounded list of cascade-deleted application+job rows from the newest
 * production backup containing all requested application UUIDs.
 *
 * The forced-command operator path validates every UUID and caps the request at ten.
 * This script still validates independently, extracts only the requested COPY rows,
 * previews non-sensitive metadata by default, and writes to the live database only
 * with --apply.
 */
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGunzip } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import pg from 'pg';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const here = path.dirname(fileURLToPath(import.meta.url));
const backend = path.resolve(here, '..');
const backups = path.join(backend, 'backups');

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const apply = argv[0] === '--apply';
  const values = apply || argv[0] === '--preview' ? argv.slice(1) : argv;
  if (values.length < 1 || values.length > 10) fail('provide between one and ten application UUIDs');
  const ids = [...new Set(values.map((value) => value.toLowerCase()))];
  if (ids.some((id) => !UUID.test(id))) fail('every application ID must be a UUID');
  return { apply, ids };
}

async function backupContainsAll(filename, ids) {
  const found = new Set();
  const stream = createReadStream(filename).pipe(createGunzip());
  let carry = '';
  for await (const chunk of stream) {
    const text = carry + chunk.toString('utf8');
    for (const id of ids) if (!found.has(id) && text.includes(id)) found.add(id);
    carry = text.slice(-40);
  }
  return found.size === ids.length;
}

async function findBackup(ids) {
  const files = (await fs.readdir(backups))
    .filter((name) => /^db-\d{8}-\d{4}\.sql\.gz$/.test(name))
    .sort()
    .reverse();
  for (const name of files) {
    const filename = path.join(backups, name);
    if (await backupContainsAll(filename, ids)) return filename;
  }
  fail('no retained database backup contains every requested application');
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.status !== 0) fail(`${command} failed: ${(result.stderr || result.stdout || '').trim()}`);
  return result.stdout;
}

export function decodeCopyField(value) {
  if (value === String.raw`\N`) return null;
  const escapes = { b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v', '\\': '\\' };
  return value.replace(/\\(?:([0-7]{1,3})|x([0-9a-fA-F]{2})|(.))/g, (match, octal, hex, other) => {
    if (octal) return String.fromCharCode(Number.parseInt(octal, 8));
    if (hex) return String.fromCharCode(Number.parseInt(hex, 16));
    const key = other?.[0] ?? '';
    return escapes[key] ?? key;
  });
}

export async function copyRows(filename, table, wantedIds) {
  const input = createReadStream(filename).pipe(createGunzip());
  const lines = createInterface({ input, crlfDelay: Infinity });
  const rows = [];
  let columns = null;
  for await (const line of lines) {
    if (!columns) {
      const match = line.match(new RegExp(`^COPY public\\.${table} \\((.+)\\) FROM stdin;$`));
      if (match) columns = match[1].split(', ').map((column) => column.replace(/^"|"$/g, ''));
      continue;
    }
    if (line === String.raw`\.`) break;
    const values = line.split('\t').map(decodeCopyField);
    if (values.length !== columns.length) fail(`unexpected ${table} COPY column count`);
    const row = Object.fromEntries(columns.map((column, index) => [column, values[index]]));
    if (wantedIds.has(row.id)) rows.push(row);
  }
  if (!columns) fail(`backup has no public.${table} COPY section`);
  return rows;
}

function cleanupStaleRecoveryDatabases() {
  const output = run('docker', [
    'exec', 'applypilot-db', 'psql', '-U', 'postgres', '-d', 'postgres',
    '-X', '-q', '-A', '-t', '-c',
    "select datname from pg_database where datname like 'jobpilot_recovery_%'",
  ]);
  for (const database of output.split('\n').map((value) => value.trim()).filter(Boolean)) {
    if (!/^jobpilot_recovery_[a-zA-Z0-9_]+$/.test(database)) fail('refusing unexpected recovery database name');
    run('docker', ['exec', 'applypilot-db', 'dropdb', '--if-exists', '-U', 'postgres', database]);
  }
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

async function insertObject(client, table, value) {
  const entries = Object.entries(value);
  const columns = entries.map(([column]) => quoteIdentifier(column)).join(', ');
  const placeholders = entries.map((_, index) => `$${index + 1}`).join(', ');
  return client.query(
    `insert into public.${quoteIdentifier(table)} (${columns}) values (${placeholders}) on conflict (id) do nothing returning id`,
    entries.map(([, item]) => item),
  );
}

async function main() {
  const { apply, ids } = parseArgs(process.argv.slice(2));
  if (!process.env.DATABASE_URL) fail('DATABASE_URL is required');
  cleanupStaleRecoveryDatabases();
  const backup = await findBackup(ids);
  const applications = await copyRows(backup, 'applications', new Set(ids));
  if (applications.length !== ids.length) fail(`backup contained ${applications.length} of ${ids.length} application rows`);
  const jobs = await copyRows(backup, 'jobs', new Set(applications.map((application) => application.job_id)));
  if (jobs.length !== applications.length) fail(`backup contained ${jobs.length} of ${applications.length} linked job rows`);
  const jobsById = new Map(jobs.map((job) => [job.id, job]));
  const recovered = applications.map((application) => ({ application, job: jobsById.get(application.job_id) }));
  if (recovered.some(({ job }) => !job)) fail('backup application is missing its linked job');

  const preview = recovered.map(({ application, job }) => ({
      application_id: application.id,
      job_id: job.id,
      title: job.title,
      company: job.company,
      location: job.location,
      status: application.status,
      parked: application.parked,
      has_resume: Boolean(application.tailored_resume),
      has_pdf: Boolean(application.pdf_path),
  }));
  if (!apply) {
    console.log(JSON.stringify({ mode: 'preview', backup: path.basename(backup), rows: preview }, null, 2));
    return;
  }

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('begin');
    for (const pair of recovered) {
      const job = { ...pair.job };
      const application = { ...pair.application };
      delete application.has_resume;
      delete application.has_cover_letter;

      const existing = await client.query(
        'select id from public.jobs where id=$1 or (user_id=$2 and url=$3) order by (id=$1) desc limit 1',
        [job.id, job.user_id, job.url],
      );
      let jobId = existing.rows[0]?.id ?? null;
      if (!jobId) {
        if (job.duplicate_of) {
          const parent = await client.query('select 1 from public.jobs where id=$1 and user_id=$2', [job.duplicate_of, job.user_id]);
          if (parent.rowCount === 0) job.duplicate_of = null;
        }
        const inserted = await insertObject(client, 'jobs', job);
        jobId = inserted.rows[0]?.id ?? job.id;
      }
      application.job_id = jobId;
      await insertObject(client, 'applications', application);
    }
    await client.query("notify pgrst, 'reload schema'");
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    await client.end();
  }
  console.log(JSON.stringify({ mode: 'applied', backup: path.basename(backup), rows: preview }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
