/** Supabase access for the worker (service role — server-only). */
import { createClient } from '@supabase/supabase-js';

const BUCKET = process.env.RESUMES_BUCKET || 'resumes';

let _client = null;
function client() {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  _client = createClient(url, key, { auth: { persistSession: false } });
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

/** Upload the PDF (overwrite) and return its storage path. */
export async function uploadPdf(path, buffer) {
  const { error } = await client().storage.from(BUCKET).upload(path, buffer, {
    contentType: 'application/pdf',
    upsert: true,
  });
  if (error) throw new Error(`upload pdf: ${error.message}`);
  return path;
}
