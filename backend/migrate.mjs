import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, '..', 'supabase', 'migrations');
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');

const client = new pg.Client({ connectionString });
await client.connect();
try {
  await client.query(`
    create table if not exists public.schema_migrations (
      filename text primary key,
      applied_at timestamptz not null default now()
    );
    create schema if not exists storage;
    create table if not exists storage.buckets (
      id text primary key,
      name text not null unique,
      public boolean not null default false
    );
  `);
  const appliedResult = await client.query('select filename from public.schema_migrations');
  const applied = new Set(appliedResult.rows.map((row) => row.filename));
  const files = (await fs.readdir(migrationsDir)).filter((file) => file.endsWith('.sql')).sort();
  for (const filename of files) {
    if (applied.has(filename)) continue;
    const sql = await fs.readFile(path.join(migrationsDir, filename), 'utf8');
    console.log(`applying ${filename}`);
    await client.query('begin');
    try {
      await client.query(sql);
      await client.query('insert into public.schema_migrations(filename) values ($1)', [filename]);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    }
  }
  await client.query("notify pgrst, 'reload schema'");
  console.log('database is up to date');
} finally {
  await client.end();
}
