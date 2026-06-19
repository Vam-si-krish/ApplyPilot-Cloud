/** Server-side data access helpers over the service-role Supabase client. */
import { supabaseAdmin } from './supabase';
import type { Settings, Profile, Run, Job, GmailConnection, MailMessage } from './types';

export async function getSettings(): Promise<Settings> {
  const { data, error } = await supabaseAdmin().from('settings').select('*').eq('id', 1).single();
  if (error) throw new Error(`Failed to load settings: ${error.message}`);
  return data as Settings;
}

export async function getProfile(): Promise<Profile> {
  const { data, error } = await supabaseAdmin().from('profile').select('*').eq('id', 1).single();
  if (error) throw new Error(`Failed to load profile: ${error.message}`);
  return data as Profile;
}

export async function getResumeText(): Promise<string> {
  const { data, error } = await supabaseAdmin().from('profile').select('resume_text').eq('id', 1).single();
  if (error) throw new Error(`Failed to load resume: ${error.message}`);
  return (data?.resume_text as string) || '';
}

export async function createRun(apifyRunId: string | null): Promise<Run> {
  const { data, error } = await supabaseAdmin()
    .from('runs')
    .insert({ apify_run_id: apifyRunId, status: 'running' })
    .select('*')
    .single();
  if (error) throw new Error(`Failed to create run: ${error.message}`);
  return data as Run;
}

export async function updateRunByApifyId(apifyRunId: string, patch: Partial<Run>): Promise<void> {
  const { error } = await supabaseAdmin().from('runs').update(patch).eq('apify_run_id', apifyRunId);
  if (error) throw new Error(`Failed to update run: ${error.message}`);
}

/** Return the internal run UUID for a given Apify run ID, or null if not found. */
export async function getRunByApifyId(apifyRunId: string): Promise<Run | null> {
  const { data, error } = await supabaseAdmin()
    .from('runs')
    .select('*')
    .eq('apify_run_id', apifyRunId)
    .maybeSingle();
  if (error) throw new Error(`Failed to look up run: ${error.message}`);
  return (data as Run) ?? null;
}

/** Count jobs still awaiting a score. */
export async function countUnscored(): Promise<number> {
  const { count, error } = await supabaseAdmin()
    .from('jobs')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'unscored');
  if (error) throw new Error(`Failed to count unscored: ${error.message}`);
  return count ?? 0;
}

/** Fetch specific jobs by id (used by manual "score selected"). Order not guaranteed. */
export async function getJobsByIds(ids: string[]): Promise<Job[]> {
  if (ids.length === 0) return [];
  const { data, error } = await supabaseAdmin().from('jobs').select('*').in('id', ids);
  if (error) throw new Error(`Failed to load jobs by id: ${error.message}`);
  return (data ?? []) as Job[];
}

/** Fetch a batch of unscored jobs to score. */
export async function getUnscoredBatch(limit: number): Promise<Job[]> {
  const { data, error } = await supabaseAdmin()
    .from('jobs')
    .select('*')
    .eq('status', 'unscored')
    .order('discovered_at', { ascending: true })
    .limit(limit);
  if (error) throw new Error(`Failed to load unscored batch: ${error.message}`);
  return (data ?? []) as Job[];
}

/** Scored jobs at/above minScore whose company hasn't been AI-assessed yet (ADR 0010). */
export async function getUnassessedHighScoreBatch(minScore: number, limit: number): Promise<Job[]> {
  const { data, error } = await supabaseAdmin()
    .from('jobs')
    .select('*')
    .eq('status', 'scored')
    .gte('fit_score', minScore)
    .is('company_tier', null)
    .order('fit_score', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Failed to load unassessed batch: ${error.message}`);
  return (data ?? []) as Job[];
}

/** Count of scored high-score jobs still awaiting company assessment. */
export async function countUnassessedHighScore(minScore: number): Promise<number> {
  const { count, error } = await supabaseAdmin()
    .from('jobs')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'scored')
    .gte('fit_score', minScore)
    .is('company_tier', null);
  if (error) throw new Error(`Failed to count unassessed: ${error.message}`);
  return count ?? 0;
}

/** The most recent run still marked 'running', if any. */
export async function getLatestRunningRun(): Promise<Run | null> {
  const { data, error } = await supabaseAdmin()
    .from('runs')
    .select('*')
    .eq('status', 'running')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Failed to load running run: ${error.message}`);
  return (data as Run) ?? null;
}

/** Add to a run's jobs_scored / errors counters. */
export async function bumpRunScored(runId: string, scored: number, errors: number): Promise<void> {
  const { data, error } = await supabaseAdmin()
    .from('runs')
    .select('jobs_scored, errors')
    .eq('id', runId)
    .single();
  if (error) throw new Error(`Failed to read run counters: ${error.message}`);
  const { error: upErr } = await supabaseAdmin()
    .from('runs')
    .update({ jobs_scored: (data.jobs_scored ?? 0) + scored, errors: (data.errors ?? 0) + errors })
    .eq('id', runId);
  if (upErr) throw new Error(`Failed to bump run counters: ${upErr.message}`);
}

/** Mark a run finished. */
export async function finalizeRun(runId: string, status: 'succeeded' | 'failed'): Promise<void> {
  const { error } = await supabaseAdmin()
    .from('runs')
    .update({ status, finished_at: new Date().toISOString() })
    .eq('id', runId);
  if (error) throw new Error(`Failed to finalize run: ${error.message}`);
}

// ── Gmail inbox (ADR 0012) ───────────────────────────────────────────────────

export async function getGmailConnection(): Promise<GmailConnection> {
  const { data, error } = await supabaseAdmin().from('gmail_connection').select('*').eq('id', 1).single();
  if (error) throw new Error(`Failed to load Gmail connection: ${error.message}`);
  return data as GmailConnection;
}

export async function updateGmailConnection(patch: Partial<GmailConnection>): Promise<void> {
  const { error } = await supabaseAdmin()
    .from('gmail_connection')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', 1);
  if (error) throw new Error(`Failed to update Gmail connection: ${error.message}`);
}

/** Insert classified messages, ignoring any already stored (de-duped by gmail_id). */
export async function insertMailMessages(rows: Partial<MailMessage>[]): Promise<number> {
  if (rows.length === 0) return 0;
  const { data, error } = await supabaseAdmin()
    .from('mail_messages')
    .upsert(rows, { onConflict: 'gmail_id', ignoreDuplicates: true })
    .select('id');
  if (error) throw new Error(`Failed to insert mail: ${error.message}`);
  return data?.length ?? 0;
}

/** Raw message stored by the fetch phase — headers + snippet, no AI category yet. */
export interface FetchedMailRow {
  gmail_id: string;
  thread_id: string | null;
  received_at: string | null;
  from_email: string | null;
  from_name: string | null;
  subject: string | null;
  snippet: string | null;
}

/**
 * Store fetched messages as 'pending' (no category yet), ignoring any already
 * stored (ADR 0013). Decouples pulling mail from classifying it, so a single run
 * hitting its cap never strands the rest of the backlog.
 */
export async function insertFetchedMail(rows: FetchedMailRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const payload = rows.map((r) => ({ ...r, status: 'pending', category: null }));
  const { data, error } = await supabaseAdmin()
    .from('mail_messages')
    .upsert(payload, { onConflict: 'gmail_id', ignoreDuplicates: true })
    .select('id');
  if (error) throw new Error(`Failed to insert fetched mail: ${error.message}`);
  return data?.length ?? 0;
}

/** A batch of fetched-but-unclassified messages, oldest first. */
export async function getPendingMailBatch(limit: number): Promise<MailMessage[]> {
  const { data, error } = await supabaseAdmin()
    .from('mail_messages')
    .select('*')
    .eq('status', 'pending')
    .order('received_at', { ascending: true, nullsFirst: true })
    .limit(limit);
  if (error) throw new Error(`Failed to load pending mail: ${error.message}`);
  return (data ?? []) as MailMessage[];
}

/** How many fetched messages still await AI classification. */
export async function countPendingMail(): Promise<number> {
  const { count, error } = await supabaseAdmin()
    .from('mail_messages')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending');
  if (error) throw new Error(`Failed to count pending mail: ${error.message}`);
  return count ?? 0;
}

/** Write the AI category + summary (+ apply source) for one message and mark it classified. */
export async function setMailClassification(
  id: string,
  category: string,
  summary: string,
  applySource: string | null = null,
): Promise<void> {
  const { error } = await supabaseAdmin()
    .from('mail_messages')
    .update({ category, summary, apply_source: applySource, status: 'classified' })
    .eq('id', id);
  if (error) throw new Error(`Failed to update mail classification: ${error.message}`);
}

/** Which of these Gmail ids are already stored (so we don't refetch them). Chunked to keep the URL small. */
export async function existingGmailIds(ids: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (let i = 0; i < ids.length; i += 150) {
    const slice = ids.slice(i, i + 150);
    const { data, error } = await supabaseAdmin().from('mail_messages').select('gmail_id').in('gmail_id', slice);
    if (error) throw new Error(`Failed to check existing mail: ${error.message}`);
    for (const r of data ?? []) found.add((r as { gmail_id: string }).gmail_id);
  }
  return found;
}

/** Minimal classified-mail rows for the Application Tracker (ADR 0014). */
export interface MailStatRow {
  received_at: string;
  category: string;
  subject: string | null;
  from_name: string | null;
  from_email: string | null;
  summary: string | null;
  apply_source: string | null;
}

/** Classified mail within the last `sinceDays`, newest first — feeds the tracker. */
export async function getClassifiedMailForStats(sinceDays = 400, limit = 5000): Promise<MailStatRow[]> {
  const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString();
  const { data, error } = await supabaseAdmin()
    .from('mail_messages')
    .select('received_at, category, subject, from_name, from_email, summary, apply_source')
    .eq('status', 'classified')
    .not('received_at', 'is', null)
    .gte('received_at', since)
    .order('received_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Failed to load mail stats: ${error.message}`);
  return (data ?? []) as MailStatRow[];
}

export async function listMail(category: string | null, limit = 200): Promise<MailMessage[]> {
  let q = supabaseAdmin().from('mail_messages').select('*').order('received_at', { ascending: false, nullsFirst: false }).limit(limit);
  if (category) q = q.eq('category', category);
  const { data, error } = await q;
  if (error) throw new Error(`Failed to list mail: ${error.message}`);
  return (data ?? []) as MailMessage[];
}
