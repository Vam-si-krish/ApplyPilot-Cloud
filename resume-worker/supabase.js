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
