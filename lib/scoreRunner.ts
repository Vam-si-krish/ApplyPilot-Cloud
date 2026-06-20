/**
 * Shared scoring runner. The single place that turns a set of job rows into
 * scores, used by both the auto-loop (/api/score-batch) and manual "score these
 * jobs" (/api/score-selected) so scoring behaviour stays identical.
 *
 * One LLM call per job; a parse failure or LLM error yields score 0 (visible,
 * never fabricated). The optional pre-filter gate (ADR 0008) marks below-threshold
 * jobs 'filtered' and skips the LLM.
 */
import { scoreJob } from './scoring';
import { makeClient, LLMClient } from './llm';
import { getActiveApiKey, isApiKeyProvider } from './credentials';
import { supabaseAdmin } from './supabase';
import type { Job, Settings } from './types';

/**
 * Build the LLM client from the active vault key for the configured provider
 * (ADR 0006). Returns undefined when no key resolves, so scoreJob falls back to
 * the env-detected singleton.
 */
export async function buildScoringClient(settings: Settings): Promise<LLMClient | undefined> {
  if (!isApiKeyProvider(settings.llm_provider)) return undefined;
  const key = await getActiveApiKey(settings.llm_provider);
  return key ? makeClient(settings.llm_provider, settings.llm_model, key) : undefined;
}

export interface ScoreRunResult {
  scored: number;
  filtered: number;
  errors: number;
}

export interface ScoreRunOptions {
  resume: string;
  client?: LLMClient;
  /** When set, apply the pre-filter gate at this threshold; when null/undefined, LLM-score every row. */
  prefilterThreshold?: number | null;
  /** When set, skip LLM scoring for jobs whose skill_match_score is below this (ADR 0019). */
  skillMatchThreshold?: number | null;
}

/** Score the given job rows in order, returning per-batch counts. */
export async function scoreJobRows(rows: Job[], opts: ScoreRunOptions): Promise<ScoreRunResult> {
  const gate = opts.prefilterThreshold ?? null;
  const skillGate = opts.skillMatchThreshold ?? null;
  let scored = 0;
  let filtered = 0;
  let errors = 0;

  for (const job of rows) {
    // Pre-scoring gate (ADR 0008): skip the LLM for jobs whose cheap match score
    // is below the threshold. A null prefilter_score (legacy/empty résumé) passes.
    if (gate != null && job.prefilter_score != null && job.prefilter_score < gate) {
      await supabaseAdmin()
        .from('jobs')
        .update({ status: 'filtered', scored_at: new Date().toISOString() })
        .eq('id', job.id);
      filtered++;
      continue;
    }

    // Skill gate (ADR 0019): skip the LLM for jobs that don't match enough of the
    // user's skills. A null skill_match_score (no skills set / other actor) passes.
    if (skillGate != null && job.skill_match_score != null && job.skill_match_score < skillGate) {
      await supabaseAdmin()
        .from('jobs')
        .update({ status: 'filtered', scored_at: new Date().toISOString() })
        .eq('id', job.id);
      filtered++;
      continue;
    }

    const result = await scoreJob(
      opts.resume,
      { title: job.title, company: job.company, location: job.location, full_description: job.full_description },
      opts.client,
    );
    if (result.score === 0) errors++;

    // Persist the weighted-rubric extras (ADR 0022): sub-scores + missing + seniority
    // in score_breakdown, plus the detected employment type for contract flagging.
    const breakdown = result.breakdown
      ? { ...result.breakdown, missing: result.missing ?? null, seniority: result.seniority ?? null }
      : null;

    const { error } = await supabaseAdmin()
      .from('jobs')
      .update({
        fit_score: result.score,
        score_note: result.note,
        score_keywords: result.keywords,
        score_reasoning: result.reasoning,
        score_breakdown: breakdown,
        employment_type: result.employment_type ?? null,
        scored_at: new Date().toISOString(),
        status: 'scored',
      })
      .eq('id', job.id);
    if (!error) scored++;
  }

  return { scored, filtered, errors };
}
