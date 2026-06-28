/** Supabase access for the worker (service role — server-only). */
import { createClient } from '@supabase/supabase-js';
import ws from 'ws';

const BUCKET = process.env.RESUMES_BUCKET || 'resumes';

let _client = null;
function client() {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  // Pass ws explicitly as the realtime transport — @supabase/realtime-js v2.108+ throws
  // "Node.js 20 detected without native WebSocket support" on Node < 22 if no transport
  // is provided (it no longer accepts a globalThis polyfill as a fallback).
  _client = createClient(url, key, { auth: { persistSession: false }, realtime: { transport: ws } });
  return _client;
}

/** Load an application row (id, status, template, tailored_resume). */
export async function getApplication(id) {
  const { data, error } = await client().from('applications').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`load application: ${error.message}`);
  return data;
}

/** Load an application joined with its job (the tailoring path needs the job text + signals). */
export async function getApplicationWithJob(id) {
  const { data, error } = await client().from('applications').select('*, job:jobs(*)').eq('id', id).maybeSingle();
  if (error) throw new Error(`load application: ${error.message}`);
  return data;
}

/** Settings row (id=1) — holds the per-task LLM provider/model (ADR 0025). */
export async function getSettings() {
  const { data, error } = await client().from('settings').select('*').eq('id', 1).single();
  if (error) throw new Error(`load settings: ${error.message}`);
  return data;
}

/** The structured base résumé (JSON Resume), or null if not parsed yet. */
export async function getBaseResume() {
  const { data, error } = await client().from('profile').select('base_resume').eq('id', 1).single();
  if (error) throw new Error(`load base résumé: ${error.message}`);
  return data?.base_resume ?? null;
}

/**
 * The active vault key for a provider (ADR 0006), with the worker's own env var as
 * a fallback — mirrors lib/credentials.getActiveApiKey. Keys are stored plaintext
 * in api_keys, reachable only via the service role.
 */
const PROVIDER_ENV = {
  gemini: 'GEMINI_API_KEY',
  openai: 'OPENAI_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
};
export async function getActiveApiKey(provider) {
  const { data, error } = await client()
    .from('api_keys')
    .select('key_value')
    .eq('provider', provider)
    .eq('is_active', true)
    .maybeSingle();
  if (error) throw new Error(`load active ${provider} key: ${error.message}`);
  const fromDb = (data?.key_value || '').trim();
  if (fromDb) return fromDb;
  const fromEnv = (process.env[PROVIDER_ENV[provider]] || '').trim();
  return fromEnv || null;
}

export async function updateApplication(id, patch) {
  const { error } = await client()
    .from('applications')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(`update application: ${error.message}`);
}

/** Fetch a set of job rows by their IDs (used by /score-jobs). */
export async function getJobsByIds(ids) {
  if (!ids || ids.length === 0) return [];
  const { data, error } = await client().from('jobs').select('*').in('id', ids);
  if (error) throw new Error(`load jobs: ${error.message}`);
  return data ?? [];
}

/**
 * The resume text used for scoring. Prefers the structured base_resume converted
 * to text; falls back to the raw resume_text string (same logic as lib/db.ts).
 */
export async function getScoringResumeText() {
  const { data, error } = await client().from('profile').select('base_resume, resume_text').eq('id', 1).single();
  if (error) throw new Error(`load resume: ${error.message}`);
  const base = data?.base_resume ?? null;
  if (base) {
    const out = [];
    const b = base.basics || {};
    if (b.name) out.push(b.name);
    if (b.label) out.push(b.label);
    if (b.summary) out.push(`\n${b.summary}`);
    if (Array.isArray(base.work) && base.work.length) {
      out.push('\nEXPERIENCE');
      for (const w of base.work) {
        const head = [w.position, w.name].filter(Boolean).join(' — ');
        const dates = [w.startDate, w.endDate].filter(Boolean).join(' to ');
        out.push([head, dates].filter(Boolean).join('  '));
        for (const h of (w.highlights || [])) out.push(`- ${h}`);
      }
    }
    if (Array.isArray(base.education) && base.education.length) {
      out.push('\nEDUCATION');
      for (const e of base.education) {
        out.push([e.studyType, e.area, e.institution].filter(Boolean).join(', '));
      }
    }
    if (Array.isArray(base.skills) && base.skills.length) {
      out.push('\nSKILLS');
      for (const s of base.skills) {
        const kws = (s.keywords || []).join(', ');
        out.push([s.name, kws].filter(Boolean).join(': '));
      }
    }
    if (Array.isArray(base.projects) && base.projects.length) {
      out.push('\nPROJECTS');
      for (const p of base.projects) {
        out.push([p.name, p.description].filter(Boolean).join(' — '));
        for (const h of (p.highlights || [])) out.push(`- ${h}`);
      }
    }
    const text = out.join('\n').trim();
    if (text) return text;
  }
  return (data?.resume_text || '');
}

/** Write score fields onto a job row. */
export async function updateJob(id, patch) {
  const { error } = await client().from('jobs').update(patch).eq('id', id);
  if (error) throw new Error(`update job ${id}: ${error.message}`);
}

/** Upload the PDF (overwrite) and return its storage path. */
export async function uploadPdf(path, buffer) {
  const { error } = await client().storage.from(BUCKET).upload(path, buffer, {
    contentType: 'application/pdf',
    upsert: true,
  });
  if (error) throw new Error(`upload pdf: ${error.message}`);
  return path;
}
