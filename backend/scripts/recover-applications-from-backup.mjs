#!/usr/bin/env node
/**
 * Restore a bounded list of cascade-deleted application+job rows from the newest
 * production backup containing all requested application UUIDs.
 *
 * The forced-command operator path validates every UUID and caps the request at ten.
 * This script still validates independently, restores the dump into an isolated
 * temporary database, previews only non-sensitive metadata by default, and writes to
 * the live database only with --apply.
 */
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGunzip } from 'node:zlib';
import { spawn, spawnSync } from 'node:child_process';
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

async function restoreDump(filename, database) {
  const gunzip = spawn('gunzip', ['-c', filename], { stdio: ['ignore', 'pipe', 'pipe'] });
  const psql = spawn(
    'docker',
    ['exec', '-i', 'applypilot-db', 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', database],
    { stdio: ['pipe', 'ignore', 'pipe'] },
  );
  gunzip.stdout.pipe(psql.stdin);
  let errors = '';
  // If psql rejects the dump, it closes stdin while gunzip is still producing data.
  // Ignore that expected secondary EPIPE so the primary PostgreSQL error below is
  // reported instead of crashing Node with an unhandled stream event.
  gunzip.stdout.on('error', (error) => {
    if (error?.code !== 'EPIPE') errors += String(error);
  });
  psql.stdin.on('error', (error) => {
    if (error?.code !== 'EPIPE') errors += String(error);
  });
  gunzip.stderr.on('data', (chunk) => { errors += chunk.toString(); });
  psql.stderr.on('data', (chunk) => { errors += chunk.toString(); });
  const [gunzipCode, psqlCode] = await Promise.all([
    new Promise((resolve) => gunzip.on('close', resolve)),
    new Promise((resolve) => psql.on('close', resolve)),
  ]);
  if (gunzipCode !== 0 || psqlCode !== 0) fail(`temporary backup restore failed: ${errors.trim()}`);
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
  const backup = await findBackup(ids);
  const tempDatabase = `jobpilot_recovery_${process.pid}_${Date.now()}`.slice(0, 63);
  run('docker', ['exec', 'applypilot-db', 'createdb', '-U', 'postgres', tempDatabase]);

  try {
    await restoreDump(backup, tempDatabase);
    const list = ids.map((id) => `'${id}'`).join(',');
    const sql = `
      select coalesce(json_agg(json_build_object(
        'application', to_jsonb(a),
        'job', to_jsonb(j)
      ) order by a.created_at)::text, '[]')
      from public.applications a
      join public.jobs j on j.user_id = a.user_id and j.id = a.job_id
      where a.id = any(array[${list}]::uuid[])
    `;
    const raw = run('docker', [
      'exec', 'applypilot-db', 'psql', '-U', 'postgres', '-d', tempDatabase,
      '-X', '-q', '-A', '-t', '-c', sql,
    ]).trim();
    const recovered = JSON.parse(raw || '[]');
    if (recovered.length !== ids.length) fail(`backup contained ${recovered.length} of ${ids.length} joined rows`);

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
  } finally {
    run('docker', ['exec', 'applypilot-db', 'dropdb', '--if-exists', '-U', 'postgres', tempDatabase]);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
