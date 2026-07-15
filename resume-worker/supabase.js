/** Supabase access for the worker (service role — server-only). */
import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import { currentUserId } from './userContext.js';
import { scoringPreferences } from './candidatePreferences.js';
import { normalizeResume } from './tailor.js';

const BUCKET = process.env.RESUMES_BUCKET || 'resumes';

const clients = new Map();
function client() {
  const userId = currentUserId();
  const cacheKey = userId || 'service';
  if (clients.has(cacheKey)) return clients.get(cacheKey);
  const url = process.env.BACKEND_URL || process.env.SUPABASE_URL;
  const key = process.env.BACKEND_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('BACKEND_URL and BACKEND_SERVICE_KEY are required');
  // Pass ws explicitly as the realtime transport — @supabase/realtime-js v2.108+ throws
  // "Node.js 20 detected without native WebSocket support" on Node < 22 if no transport
  // is provided (it no longer accepts a globalThis polyfill as a fallback).
  const instance = createClient(url, key, {
    auth: { persistSession: false },
    realtime: { transport: ws },
    ...(userId ? { global: { headers: { 'x-jobpilot-user-id': userId } } } : {}),
  });
  clients.set(cacheKey, instance);
  return instance;
}

/** Load an application row (id, status, template, tailored_resume). */
export async function getApplication(id) {
  const { data, error } = await client().from('applications').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`load application: ${error.message}`);
  if (data?.tailored_resume) data.tailored_resume = normalizeResume(data.tailored_resume);
  return data;
}

/** Load an application joined with its job (the tailoring path needs the job text + signals). */
export async function getApplicationWithJob(id) {
  const { data, error } = await client().from('applications').select('*, job:jobs(*)').eq('id', id).maybeSingle();
  if (error) throw new Error(`load application: ${error.message}`);
  if (data?.tailored_resume) data.tailored_resume = normalizeResume(data.tailored_resume);
  return data;
}

/**
 * Applications awaiting tailoring (ADR 0043) — status 'queued' and not yet generated,
 * joined with their job (the queue worker needs the job text + signals). Rows whose job
 * was removed are skipped here (inner-join semantics via the not-null filter) so the
 * nightly batch only spends LLM calls on tailorable rows. Oldest first = FIFO drain.
 */
export async function getQueuedApplications() {
  const { data, error } = await client()
    .from('applications')
    .select('*, job:jobs(*)')
    .eq('status', 'queued')
    // "Set Aside" rows (ADR 0061) are deliberately out of the way — the drain skips them.
    .eq('parked', false)
    .is('tailored_resume', null)
    .not('job_id', 'is', null)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`load queued applications: ${error.message}`);
  // Defensively drop any row whose job didn't join (deleted job) — those aren't tailorable.
  return (data || []).filter((a) => a.job);
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
  return data?.base_resume ? normalizeResume(data.base_resume) : null;
}

export async function getCandidatePreferences() {
  const { data, error } = await client().from('profile').select('candidate_preferences').eq('id', 1).single();
  if (error) throw new Error(`load candidate preferences: ${error.message}`);
  return data?.candidate_preferences ?? {};
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
  if (process.env.BACKEND_URL) return null;
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
 * Flatten a JSON-Resume doc to the plain-text shape the scorer expects (mirrors the
 * cloud's resumeToText / lib/db). Used for both the base résumé (scoring jobs) and a
 * TAILORED résumé (scoring it overnight, ADR 0043). Returns '' for an empty/invalid doc.
 */
export function resumeToScoringText(resume) {
  if (!resume || typeof resume !== 'object') return '';
  const out = [];
  const b = resume.basics || {};
  if (b.name) out.push(b.name);
  if (b.label) out.push(b.label);
  if (b.summary) out.push(`\n${b.summary}`);
  if (Array.isArray(resume.work) && resume.work.length) {
    out.push('\nEXPERIENCE');
    for (const w of resume.work) {
      const head = [w.position, w.name].filter(Boolean).join(' — ');
      const dates = [w.startDate, w.endDate].filter(Boolean).join(' to ');
      out.push([head, dates].filter(Boolean).join('  '));
      for (const h of (w.highlights || [])) out.push(`- ${h}`);
    }
  }
  if (Array.isArray(resume.education) && resume.education.length) {
    out.push('\nEDUCATION');
    for (const e of resume.education) {
      out.push([e.studyType, e.area, e.institution].filter(Boolean).join(', '));
    }
  }
  if (Array.isArray(resume.skills) && resume.skills.length) {
    out.push('\nSKILLS');
    for (const s of resume.skills) {
      const kws = (s.keywords || []).join(', ');
      out.push([s.name, kws].filter(Boolean).join(': '));
    }
  }
  if (Array.isArray(resume.projects) && resume.projects.length) {
    out.push('\nPROJECTS');
    for (const p of resume.projects) {
      out.push([p.name, p.description].filter(Boolean).join(' — '));
      for (const h of (p.highlights || [])) out.push(`- ${h}`);
    }
  }
  if (Array.isArray(resume.customSections)) {
    for (const section of resume.customSections) {
      if (!section?.title && !(section?.items || []).length) continue;
      out.push(`\n${String(section.title || 'ADDITIONAL').toUpperCase()}`);
      for (const item of (section.items || [])) {
        const head = [item.name, item.description].filter(Boolean).join(' — ');
        const meta = [item.date, item.location].filter(Boolean).join(' · ');
        out.push([head, meta].filter(Boolean).join('  '));
        if (item.url) out.push(item.url);
        for (const h of (item.highlights || [])) out.push(`- ${h}`);
      }
    }
  }
  return out.join('\n').trim();
}

/**
 * The resume text used for scoring — the enriched dossier (ADR 0066): rendered text PLUS
 * the structured base_resume JSON, so the cached scoring prefix clears Haiku's 4096-token
 * minimum and the scorer gets authoritative structured grounding. Mirrors lib/db.ts
 * getScoringCandidateContext / composeScoringCandidateContext. This worker path is AI
 * scoring only, so it also includes explicit user-maintained eligibility facts.
 */
export async function getScoringCandidateContext() {
  const { data, error } = await client().from('profile').select('base_resume, resume_text, work_authorization, candidate_preferences').eq('id', 1).single();
  if (error) throw new Error(`load resume: ${error.message}`);
  const base = data?.base_resume ?? null;
  const text = resumeToScoringText(base) || (data?.resume_text || '');
  if (!text) return '';
  const parts = [text];
  if (base) {
    parts.push(
      `STRUCTURED RÉSUMÉ (JSON — authoritative employers, titles, dates, and education):\n${JSON.stringify(base)}`,
    );
  }
  parts.push(
    `USER-MAINTAINED PROFILE FACTS (JSON — authoritative only for fields explicitly present; missing means unknown):\n` +
      JSON.stringify({
        work_authorization: data?.work_authorization ?? {},
        scoring_preferences: scoringPreferences(data?.candidate_preferences),
      }),
  );
  return parts.join('\n\n---\n');
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
