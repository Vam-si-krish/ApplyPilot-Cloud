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

/** Which LLM is used for which kind of work (ADR 0025). */
export type LlmTask = 'score' | 'tailor';

/** Provider+model for a task, falling back to the global llm_* when unset. */
function taskProviderModel(settings: Settings, task: LlmTask): { provider: string; model: string } {
  if (task === 'tailor') {
    return { provider: settings.tailor_provider || settings.llm_provider, model: settings.tailor_model || settings.llm_model };
  }
  return { provider: settings.score_provider || settings.llm_provider, model: settings.score_model || settings.llm_model };
}

/**
 * Build the LLM client for a task from the active vault key for that task's
 * provider (ADR 0006/0025). Returns undefined when no key resolves, so the caller
 * falls back to the env-detected singleton.
 */
export async function buildClientForTask(settings: Settings, task: LlmTask): Promise<LLMClient | undefined> {
  const { provider, model } = taskProviderModel(settings, task);
  if (!isApiKeyProvider(provider)) return undefined;
  const key = await getActiveApiKey(provider);
  return key ? makeClient(provider, model, key) : undefined;
}

/** Scoring / company-assessment client (cheap, high-volume task). */
export async function buildScoringClient(settings: Settings): Promise<LLMClient | undefined> {
  return buildClientForTask(settings, 'score');
}

/** Tailoring / résumé-parse client (quality task). */
export async function buildTailoringClient(settings: Settings): Promise<LLMClient | undefined> {
  return buildClientForTask(settings, 'tailor');
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

/**
 * How many jobs to score concurrently. The scoring is exactly ONE LLM call per job and
 * the calls are independent, so running them in parallel (instead of one-at-a-time) is a
 * pure latency win with NO change to quality — same prompt, model, and per-job call. The
 * LLM client backs off on 429/503, so a small pool is safe; tune via env if a provider's
 * rate limit is tight. A batch is ≤10 rows, so 8 effectively parallelizes a whole chunk.
 */
const SCORE_CONCURRENCY = Math.max(1, Number(process.env.SCORE_CONCURRENCY) || 8);

/** Score the given job rows, returning per-batch counts. LLM calls run concurrently
 *  (bounded by SCORE_CONCURRENCY); ordering doesn't matter since each row writes itself. */
export async function scoreJobRows(rows: Job[], opts: ScoreRunOptions): Promise<ScoreRunResult> {
  const gate = opts.prefilterThreshold ?? null;
  const skillGate = opts.skillMatchThreshold ?? null;
  let scored = 0;
  let filtered = 0;
  let errors = 0;

  // Process one row: cheap DB-only gates, or the single LLM call + write. Self-contained
  // and guarded so one bad row can't fail the whole (now concurrent) batch.
  async function processRow(job: Job): Promise<void> {
    try {
      // Pre-scoring gate (ADR 0008): skip the LLM for jobs whose cheap match score
      // is below the threshold. A null prefilter_score (legacy/empty résumé) passes.
      if (gate != null && job.prefilter_score != null && job.prefilter_score < gate) {
        await supabaseAdmin()
          .from('jobs')
          .update({ status: 'filtered', scored_at: new Date().toISOString() })
          .eq('id', job.id);
        filtered++;
        return;
      }

      // Skill gate (ADR 0019): skip the LLM for jobs that don't match enough of the
      // user's skills. A null skill_match_score (no skills set / other actor) passes.
      if (skillGate != null && job.skill_match_score != null && job.skill_match_score < skillGate) {
        await supabaseAdmin()
          .from('jobs')
          .update({ status: 'filtered', scored_at: new Date().toISOString() })
          .eq('id', job.id);
        filtered++;
        return;
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
    } catch {
      errors++;
    }
  }

  // Bounded-concurrency pool: up to SCORE_CONCURRENCY rows in flight at once. Workers
  // pull from a shared queue until it's drained.
  const queue = [...rows];
  const runWorker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      await processRow(job);
    }
  };
  await Promise.all(Array.from({ length: Math.min(SCORE_CONCURRENCY, rows.length) }, runWorker));

  return { scored, filtered, errors };
}
