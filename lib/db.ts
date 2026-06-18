/** Server-side data access helpers over the service-role Supabase client. */
import { supabaseAdmin } from './supabase';
import type { Settings, Profile, Run, Job } from './types';

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
