/** Server-side data access helpers over the service-role Supabase client. */
import { supabaseAdmin } from './supabase';
import type { Settings, Profile, Run, Job, GmailConnection, MailMessage, ResumeDoc, Application, ApplicationWithJob, ScoringState } from './types';

// ── Scoring session: single-flight lock + progress (ADR 0028) ────────────────

/** Stale-heartbeat window: a chain whose heartbeat is older than this is presumed
 *  dead (crashed function) and its lock can be re-acquired. Must exceed the worst
 *  case for one batch (5 LLM calls with rate-limit back-off). */
const SCORING_STALE_MS = 120_000;

/** Current scoring session row (id=1), or null if the table is empty. */
export async function getScoringState(): Promise<ScoringState | null> {
  const { data, error } = await supabaseAdmin().from('scoring_state').select('*').eq('id', 1).maybeSingle();
  if (error) throw new Error(`Failed to load scoring state: ${error.message}`);
  return (data as ScoringState) ?? null;
}

/**
 * Atomically acquire the scoring lock (compare-and-swap). Succeeds only when no
 * chain is active OR the active one's heartbeat is stale. A single-row conditional
 * UPDATE is atomic in Postgres, so exactly one of N concurrent callers wins —
 * which is what stops duplicate scoring. Returns true if this caller acquired it.
 */
export async function acquireScoringLock(total: number, token: string): Promise<boolean> {
  const now = new Date().toISOString();
  const staleBefore = new Date(Date.now() - SCORING_STALE_MS).toISOString();
  const { data, error } = await supabaseAdmin()
    .from('scoring_state')
    .update({
      active: true, stop_requested: false, rescan_requested: false,
      token, total, done: 0, errors: 0, started_at: now, heartbeat: now, updated_at: now,
    })
    .eq('id', 1)
    .or(`active.eq.false,heartbeat.lt.${staleBefore}`)
    .select('id');
  if (error) throw new Error(`Failed to acquire scoring lock: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

/**
 * Validate that `token` still owns the active session and refresh its heartbeat,
 * returning the current row (or null if superseded). Used at the top of each
 * continuation batch — also how a stop is detected (st.stop_requested).
 */
export async function touchScoringSession(token: string): Promise<ScoringState | null> {
  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin()
    .from('scoring_state')
    .update({ heartbeat: now, updated_at: now })
    .eq('id', 1).eq('active', true).eq('token', token)
    .select('*').maybeSingle();
  if (error) throw new Error(`Failed to touch scoring session: ${error.message}`);
  return (data as ScoringState) ?? null;
}

/** Write live progress (done/errors) for the owning session and refresh heartbeat. */
export async function updateScoringProgress(token: string, done: number, errors: number, total?: number): Promise<void> {
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { done, errors, heartbeat: now, updated_at: now };
  if (total != null) patch.total = total;
  const { error } = await supabaseAdmin().from('scoring_state').update(patch).eq('id', 1).eq('token', token);
  if (error) throw new Error(`Failed to update scoring progress: ${error.message}`);
}

/** Release the lock (mark idle). Scoped to the owning token so a superseding chain isn't clobbered. */
export async function releaseScoringLock(token: string): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabaseAdmin()
    .from('scoring_state')
    .update({ active: false, stop_requested: false, rescan_requested: false, token: null, heartbeat: now, updated_at: now })
    .eq('id', 1).eq('token', token);
  if (error) throw new Error(`Failed to release scoring lock: ${error.message}`);
}

/** Request a stop of the active session (the chain halts after its current batch). */
export async function requestScoringStop(): Promise<void> {
  const { error } = await supabaseAdmin()
    .from('scoring_state')
    .update({ stop_requested: true, updated_at: new Date().toISOString() })
    .eq('id', 1).eq('active', true);
  if (error) throw new Error(`Failed to request scoring stop: ${error.message}`);
}

/** Flag that new unscored rows arrived while a chain held the lock (avoids orphans). */
export async function requestScoringRescan(): Promise<void> {
  const { error } = await supabaseAdmin()
    .from('scoring_state')
    .update({ rescan_requested: true, updated_at: new Date().toISOString() })
    .eq('id', 1).eq('active', true);
  if (error) throw new Error(`Failed to request scoring rescan: ${error.message}`);
}

/** Atomically read-and-clear the rescan flag for the owning session. */
export async function consumeScoringRescan(token: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin()
    .from('scoring_state')
    .update({ rescan_requested: false, updated_at: new Date().toISOString() })
    .eq('id', 1).eq('token', token).eq('rescan_requested', true)
    .select('id');
  if (error) throw new Error(`Failed to consume scoring rescan: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

/** True when the active session's heartbeat is stale (presumed-dead chain). */
export function isScoringStale(s: ScoringState | null): boolean {
  if (!s || !s.active || !s.heartbeat) return false;
  return Date.now() - new Date(s.heartbeat).getTime() > SCORING_STALE_MS;
}

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

// ── Base résumé + Applications (ADR 0024) ────────────────────────────────────

/** The structured base résumé (JSON Resume), or null if not parsed yet. */
export async function getBaseResume(): Promise<ResumeDoc | null> {
  const { data, error } = await supabaseAdmin().from('profile').select('base_resume').eq('id', 1).single();
  if (error) throw new Error(`Failed to load base résumé: ${error.message}`);
  return (data?.base_resume as ResumeDoc | null) ?? null;
}

/** Persist the structured base résumé. */
export async function saveBaseResume(doc: ResumeDoc): Promise<void> {
  const { error } = await supabaseAdmin()
    .from('profile')
    .update({ base_resume: doc, updated_at: new Date().toISOString() })
    .eq('id', 1);
  if (error) throw new Error(`Failed to save base résumé: ${error.message}`);
}

/** All applications joined with their job, newest first. */
export async function listApplications(): Promise<ApplicationWithJob[]> {
  const { data, error } = await supabaseAdmin()
    .from('applications')
    .select('*, job:jobs(*)')
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Failed to list applications: ${error.message}`);
  return (data ?? []) as ApplicationWithJob[];
}

/**
 * Queue an application for each given job (idempotent — ignores jobs already in
 * Applications via the unique job_id). Returns how many new rows were created.
 */
export async function addApplications(jobIds: string[]): Promise<number> {
  if (jobIds.length === 0) return 0;
  const rows = jobIds.map((job_id) => ({ job_id, status: 'queued' }));
  const { data, error } = await supabaseAdmin()
    .from('applications')
    .upsert(rows, { onConflict: 'job_id', ignoreDuplicates: true })
    .select('id');
  if (error) throw new Error(`Failed to add applications: ${error.message}`);
  return data?.length ?? 0;
}

/** One application joined with its job (used by the generate route). */
export async function getApplicationWithJob(id: string): Promise<ApplicationWithJob | null> {
  const { data, error } = await supabaseAdmin()
    .from('applications')
    .select('*, job:jobs(*)')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`Failed to load application: ${error.message}`);
  return (data as ApplicationWithJob) ?? null;
}

/** Patch an application row (stamps updated_at). */
export async function updateApplication(id: string, patch: Partial<Application>): Promise<void> {
  const { error } = await supabaseAdmin()
    .from('applications')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(`Failed to update application: ${error.message}`);
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
