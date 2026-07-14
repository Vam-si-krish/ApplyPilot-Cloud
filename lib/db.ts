/** Server-side data access helpers over the service-role Supabase client. */
import { randomUUID } from 'crypto';
import { supabaseAdmin } from './supabase';
import { resumeToText } from './resume';
import { partitionByGeneration, pickCanonical } from './dedupe';
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

/**
 * The résumé text used for SCORING (ADR 0036). The structured base résumé is the single
 * source of truth: it's serialized to recruiter-readable text. Falls back to the legacy
 * `resume_text` only when no base résumé exists yet (safety during transition).
 */
export async function getScoringResumeText(): Promise<string> {
  const { data, error } = await supabaseAdmin()
    .from('profile')
    .select('base_resume, resume_text')
    .eq('id', 1)
    .single();
  if (error) throw new Error(`Failed to load resume: ${error.message}`);
  const base = (data?.base_resume as ResumeDoc | null) ?? null;
  const text = base ? resumeToText(base).trim() : '';
  return composeScoringResume(base, text) || ((data?.resume_text as string) || '');
}

/**
 * Enriched scoring dossier (ADR 0066): the plain-text résumé PLUS the structured
 * base_resume JSON. Both are per-candidate constants, so together they form the STABLE,
 * cached scoring prefix across every job in a run — and the added bulk lifts that prefix
 * over Haiku's 4,096-token minimum cacheable prefix (a plain-text-only résumé is too short
 * to cache on Haiku). The JSON also gives the scorer authoritative structured grounding
 * (exact dates, every bullet, education). Returns the rendered text unchanged when there's
 * no structured base to add.
 */
export function composeScoringResume(base: ResumeDoc | null, renderedText: string): string {
  if (!base || !renderedText) return renderedText;
  return (
    `${renderedText}\n\n---\n` +
    `STRUCTURED RÉSUMÉ (JSON — authoritative employers, titles, dates, and education):\n` +
    JSON.stringify(base)
  );
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

/**
 * All applications joined with their job, newest first — SLIM projection for the list
 * view. The heavy documents (tailored_resume, cover_letter, job.full_description) are
 * deliberately excluded: at ~650 rows they made this response ~11 MB. The list only
 * needs existence (the generated has_resume / has_cover_letter flags, migration 0043);
 * the full row comes from getApplicationWithJob() when a row is expanded.
 */
export async function listApplications(): Promise<ApplicationWithJob[]> {
  const { data, error } = await supabaseAdmin()
    .from('applications')
    .select(
      'id, job_id, status, template, pdf_path, error, created_at, updated_at, applied_at, ' +
        'tailor_changes, tailored_fit_score, tailored_score_note, cover_letter_pdf_path, cover_letter_error, ' +
        'tailor_instructions, tailored_match_score, tailored_match_breakdown, base_match_score, parked, ' +
        'tailor_usage, has_resume, has_cover_letter, ' +
        'job:jobs(id, title, company, url, location, fit_score, employment_type, company_tier, company_tier_note, application_url, clicked_at, discovered_at, source)',
    )
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Failed to list applications: ${error.message}`);
  return (data ?? []) as unknown as ApplicationWithJob[];
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
    .upsert(rows, { onConflict: 'user_id,job_id', ignoreDuplicates: true })
    .select('id');
  if (error) throw new Error(`Failed to add applications: ${error.message}`);
  return data?.length ?? 0;
}

/**
 * Create a manually-entered job + its application in one step (ADR 0034). For a job the
 * user adds by hand (e.g. from a recruiter email) so they can tailor a résumé to it.
 * Company and link are OPTIONAL; only the title + description are required (the
 * description is what tailoring reads). The job is flagged `source='manual'` (hidden from
 * the scraped Jobs list) and `status='scored'` with no fit_score so the scoring loop
 * skips it. `jobs.url` is unique + not-null, so a synthetic internal url is always used
 * and the user's link (if any) is stored in `application_url` — no collision with scraped rows.
 */
export async function createCustomApplication(input: {
  title: string;
  company?: string | null;
  url?: string | null;
  description: string;
}): Promise<ApplicationWithJob> {
  const title = input.title.trim();
  const description = input.description.trim();
  if (!title) throw new Error('A job title is required.');
  if (!description) throw new Error('A job description is required — it is what the résumé is tailored to.');

  const { data: job, error: jobErr } = await supabaseAdmin()
    .from('jobs')
    .insert({
      url: `manual:${randomUUID()}`,
      application_url: (input.url || '').trim() || null,
      title,
      company: (input.company || '').trim() || null,
      full_description: description,
      status: 'scored', // not 'unscored' → the scoring loop ignores it
      source: 'manual', // hidden from the scraped Jobs list
    })
    .select('*')
    .single();
  if (jobErr) throw new Error(`Failed to create custom job: ${jobErr.message}`);

  const { data: appRow, error: appErr } = await supabaseAdmin()
    .from('applications')
    .insert({ job_id: (job as Job).id, status: 'queued' })
    .select('*, job:jobs(*)')
    .single();
  if (appErr) throw new Error(`Failed to create application: ${appErr.message}`);
  return appRow as ApplicationWithJob;
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

export async function createRun(apifyRunId: string | null, apifyApiKeyId: string | null = null): Promise<Run> {
  const { data, error } = await supabaseAdmin()
    .from('runs')
    .insert({ apify_run_id: apifyRunId, apify_api_key_id: apifyApiKeyId, status: 'running' })
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
    // Canonicals before duplicates (ADR 0057): by the time a duplicate row is
    // processed its canonical is usually scored, so it copies instead of calling the LLM.
    .order('duplicate_of', { ascending: true, nullsFirst: true })
    .order('discovered_at', { ascending: true })
    .limit(limit);
  if (error) throw new Error(`Failed to load unscored batch: ${error.message}`);
  return (data ?? []) as Job[];
}

/**
 * Link duplicate postings (ADR 0057, revised by ADR 0071). Rows sharing a content key
 * are first split into requisition GENERATIONS by the UTC day they were discovered
 * (partitionByGeneration) — a duplicate is a duplicate only within a single day, so an
 * old opening and a later re-post never merge. Within each generation: the earliest
 * still-unlinked row is (or stays) the canonical; every other unlinked row gets
 * `duplicate_of`, and — when the canonical is already AI-scored and the duplicate
 * isn't — a verbatim copy of the canonical's score (identical content; the rubric
 * doesn't score location; zero LLM calls, never fabricated). Returns how many rows
 * were linked.
 */
export async function linkDuplicateJobs(keys: (string | null)[]): Promise<number> {
  const uniq = [...new Set(keys.filter((k): k is string => !!k))];
  if (uniq.length === 0) return 0;

  type Row = Pick<Job, 'id' | 'content_key' | 'duplicate_of' | 'fit_score' | 'score_note' | 'score_keywords' | 'score_reasoning' | 'score_breakdown' | 'employment_type' | 'status' | 'location' | 'discovered_at'>;
  // PostgREST `in` filters travel in the URL — chunk the key list so a big batch
  // (or the backfill) can't overflow the request line.
  const rows: Row[] = [];
  for (let i = 0; i < uniq.length; i += 100) {
    const { data, error } = await supabaseAdmin()
      .from('jobs')
      .select('id, content_key, duplicate_of, fit_score, score_note, score_keywords, score_reasoning, score_breakdown, employment_type, status, location, discovered_at')
      .in('content_key', uniq.slice(i, i + 100))
      .order('discovered_at', { ascending: true });
    if (error) throw new Error(`Failed to load duplicate groups: ${error.message}`);
    rows.push(...((data ?? []) as Row[]));
  }

  // Generation split (ADR 0071): linking only within (content_key, UTC day). A generation
  // whose members are historically linked to a canonical OUTSIDE it (old cross-day links
  // from before 0071) simply elects its own canonical — never re-parented.
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const g = groups.get(r.content_key!) ?? [];
    g.push(r);
    groups.set(r.content_key!, g);
  }

  // Canonical preference (ADR 0057 addendum): Remote > a Settings location > scored > earliest.
  const preferredLocations = await getSettings().then((s) => s.locations ?? []).catch(() => [] as string[]);

  let linked = 0;
  for (const keyGroup of groups.values()) {
    for (const group of partitionByGeneration(keyGroup)) {
      // A group that already has a canonical keeps it (rows point at it — never re-parent,
      // that would create chains). Otherwise pick the best representative to stay visible.
      const linkedTargets = new Set(group.map((r) => r.duplicate_of).filter(Boolean));
      const unlinked = group.filter((r) => r.duplicate_of == null);
      const canonical = group.find((r) => linkedTargets.has(r.id)) ?? (unlinked.length ? pickCanonical(unlinked, preferredLocations) : null);
      if (!canonical) continue;
      const dupes = group.filter((r) => r.id !== canonical.id && r.duplicate_of == null);
      if (dupes.length === 0) continue;

      // Unscored working rows inherit the canonical's score; rows with their own score
      // (pre-0057 history) or archived rows are linked without being touched otherwise.
      const canCopy = canonical.fit_score != null;
      const copyIds = canCopy
        ? dupes.filter((d) => d.fit_score == null && (d.status === 'unscored' || d.status === 'filtered')).map((d) => d.id)
        : [];
      const linkOnlyIds = dupes.map((d) => d.id).filter((id) => !copyIds.includes(id));

      if (copyIds.length > 0) {
        const { error: e1 } = await supabaseAdmin()
          .from('jobs')
          .update({
            duplicate_of: canonical.id,
            fit_score: canonical.fit_score,
            score_note: canonical.score_note,
            score_keywords: canonical.score_keywords,
            score_reasoning: canonical.score_reasoning,
            score_breakdown: canonical.score_breakdown,
            employment_type: canonical.employment_type,
            status: 'scored',
            scored_at: new Date().toISOString(),
          })
          .in('id', copyIds);
        if (e1) throw new Error(`Failed to copy scores to duplicates: ${e1.message}`);
        linked += copyIds.length;
      }
      if (linkOnlyIds.length > 0) {
        const { error: e2 } = await supabaseAdmin().from('jobs').update({ duplicate_of: canonical.id }).in('id', linkOnlyIds);
        if (e2) throw new Error(`Failed to link duplicates: ${e2.message}`);
        linked += linkOnlyIds.length;
      }
    }
  }
  return linked;
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
/** Newest run row regardless of status — the /api/run cooldown guard (ADR 0058). */
export async function getLatestRun(): Promise<Run | null> {
  const { data, error } = await supabaseAdmin()
    .from('runs')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Failed to load latest run: ${error.message}`);
  return (data as Run) ?? null;
}

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
    .upsert(rows, { onConflict: 'user_id,gmail_id', ignoreDuplicates: true })
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
    .upsert(payload, { onConflict: 'user_id,gmail_id', ignoreDuplicates: true })
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
