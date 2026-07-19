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
import { ensureCompanyAssessments } from './companyAssessment';
import { isSubscriptionProvider, makeClient, makeWorkerClient, LLMClient } from './llm';
import { currentUserId } from './userContext';
import { getActiveApiKey, isApiKeyProvider } from './credentials';
import { supabaseAdmin } from './supabase';
import type { Job, Settings } from './types';
import { resolveWorkerConfig } from './workerConfig';

/** Which LLM is used for which kind of work (ADR 0025). */
export type LlmTask = 'chat' | 'score' | 'tailor';

type ProviderModel = { provider: string; model: string };

/** Pick the first COMPLETE provider/model pair. Keeping the pair together prevents a
 * rolling migration from combining one lane's provider with another lane's model. */
function firstCompletePair(...pairs: ProviderModel[]): ProviderModel {
  return pairs.find((pair) => pair.provider.trim() && pair.model.trim()) ?? pairs[pairs.length - 1];
}

/** Provider+model for a task, with backward-compatible complete-pair fallbacks.
 * Chat used the score lane before ADR 0069, so a pre-migration row must keep doing so. */
export function taskProviderModel(settings: Settings, task: LlmTask): ProviderModel {
  const global = { provider: settings.llm_provider || '', model: settings.llm_model || '' };
  const score = { provider: settings.score_provider || '', model: settings.score_model || '' };
  if (task === 'chat') {
    return firstCompletePair(
      { provider: settings.chat_provider || '', model: settings.chat_model || '' },
      score,
      global,
    );
  }
  if (task === 'tailor') {
    return firstCompletePair(
      { provider: settings.tailor_provider || '', model: settings.tailor_model || '' },
      global,
    );
  }
  return firstCompletePair(score, global);
}

/**
 * Build the LLM client for a task (ADR 0006/0025/0042/0069).
 * - a subscription provider: route the task to the worker's /llm, which runs it via
 *   the Claude Agent SDK or OpenAI Codex SDK — no vault/API key is used. If the
 *   worker isn't configured we THROW (never silently fall back to a paid env key,
 *   which would defeat the point); for scoring this surfaces as a visible score-0.
 * - an API provider: build from the active vault key; returns undefined when no key
 *   resolves, so the caller falls back to the env-detected singleton.
 */
export async function buildClientForTask(settings: Settings, task: LlmTask): Promise<LLMClient | undefined> {
  const selected = taskProviderModel(settings, task);
  const provider = selected.provider.trim().toLowerCase();
  const model = selected.model.trim();

  if (isSubscriptionProvider(provider)) {
    // Always return a worker client (never throw here — an unhandled throw inside a
    // serverless handler surfaces to the browser as an opaque 502). If the worker
    // URL/secret can't be resolved, the client fails legibly at call time, which the
    // callers already handle (scoreJob → visible score-0 with the reason; assistant →
    // clean error). We never silently fall back to a paid API key.
    const worker = resolveWorkerConfig(settings);
    return makeWorkerClient(worker?.url ?? '', worker?.secret ?? '', model, provider, currentUserId() ?? '');
  }

  if (!isApiKeyProvider(provider)) return undefined;
  const key = await getActiveApiKey(provider);
  if (!key && process.env.BACKEND_URL) {
    throw new Error(`No active ${provider} API key — add your own key under Settings → Connections & Keys.`);
  }
  return key ? makeClient(provider, model, key) : undefined;
}

/** Scoring / company-assessment client (cheap, high-volume task). */
export async function buildScoringClient(settings: Settings): Promise<LLMClient | undefined> {
  return buildClientForTask(settings, 'score');
}

/** ApplyBuddy chat client (independent from scoring since ADR 0069). */
export async function buildChatClient(settings: Settings): Promise<LLMClient | undefined> {
  return buildClientForTask(settings, 'chat');
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

  // Company assessment (ADR 0107): one batched call covers every company in this
  // chunk that hasn't been assessed yet, then verdicts are stamped onto the jobs.
  // Guarded — an assessment failure leaves companies visibly unassessed and must
  // never block scoring.
  try {
    await ensureCompanyAssessments(rows, opts.client);
  } catch (e) {
    console.error('[score-runner] company assessment failed:', e instanceof Error ? e.message : String(e));
  }

  // Process one row: cheap DB-only gates, or the single LLM call + write. Self-contained
  // and guarded so one bad row can't fail the whole (now concurrent) batch.
  async function processRow(job: Job): Promise<void> {
    try {
      // Pre-scoring gate (ADR 0008): skip the LLM for jobs whose cheap match score
      // is below the threshold. A null prefilter_score (legacy/empty résumé) passes.
      if (gate != null && job.prefilter_score != null && job.prefilter_score < gate) {
        const { error } = await supabaseAdmin()
          .from('jobs')
          .update({ status: 'filtered', scored_at: new Date().toISOString() })
          .eq('id', job.id);
        if (error) throw new Error(`persist pre-filter result: ${error.message}`);
        filtered++;
        return;
      }

      // Skill gate (ADR 0019): skip the LLM for jobs that don't match enough of the
      // user's skills. A null skill_match_score (no skills set / other actor) passes.
      if (skillGate != null && job.skill_match_score != null && job.skill_match_score < skillGate) {
        const { error } = await supabaseAdmin()
          .from('jobs')
          .update({ status: 'filtered', scored_at: new Date().toISOString() })
          .eq('id', job.id);
        if (error) throw new Error(`persist skill-filter result: ${error.message}`);
        filtered++;
        return;
      }

      // Duplicate posting (ADR 0057): identical content to its canonical row, so it
      // inherits the canonical's outcome instead of a fresh LLM call (the rubric does
      // not score location — this is a copy, never a fabrication). getUnscoredBatch
      // orders canonicals first, so the canonical is usually resolved by now; if it's
      // still unscored (same concurrent batch), fall through and score normally.
      if (job.duplicate_of) {
        const { data: canonical } = await supabaseAdmin()
          .from('jobs')
          .select('fit_score, score_note, score_keywords, score_reasoning, score_breakdown, employment_type, company_tier, company_tier_note, tech_stack, status')
          .eq('id', job.duplicate_of)
          .maybeSingle();
        if (canonical?.fit_score != null) {
          const { error } = await supabaseAdmin()
            .from('jobs')
            .update({
              fit_score: canonical.fit_score,
              score_note: canonical.score_note,
              score_keywords: canonical.score_keywords,
              score_reasoning: canonical.score_reasoning,
              score_breakdown: canonical.score_breakdown,
              employment_type: canonical.employment_type,
              // Same content ⇒ inherit the canonical's company assessment + tech stack (ADR 0065).
              company_tier: canonical.company_tier,
              company_tier_note: canonical.company_tier_note,
              tech_stack: canonical.tech_stack,
              status: 'scored',
              scored_at: new Date().toISOString(),
            })
            .eq('id', job.id);
          if (error) throw new Error(`persist inherited score: ${error.message}`);
          scored++;
          return;
        }
        if (canonical?.status === 'filtered') {
          const { error } = await supabaseAdmin()
            .from('jobs')
            .update({ status: 'filtered', scored_at: new Date().toISOString() })
            .eq('id', job.id);
          if (error) throw new Error(`persist inherited filter result: ${error.message}`);
          filtered++;
          return;
        }
      }

      const result = await scoreJob(
        opts.resume,
        { title: job.title, company: job.company, company_size: job.company_size, location: job.location, full_description: job.full_description },
        opts.client,
      );
      if (result.score === 0) errors++;

      // Persist the weighted-rubric extras (ADR 0022): sub-scores + missing + seniority
      // in score_breakdown, plus the detected employment type for contract flagging.
      const breakdown = result.breakdown
        ? { ...result.breakdown, missing: result.missing ?? null, seniority: result.seniority ?? null }
        : null;

      const scorePatch: Record<string, unknown> = {
        fit_score: result.score,
        score_note: result.note,
        score_keywords: result.keywords,
        score_reasoning: result.reasoning,
        score_breakdown: breakdown,
        tech_stack: result.tech_stack ?? null,
        // Per-score token/cache/cost usage (ADR 0066); null when the provider didn't report it.
        score_usage: result.usage ?? null,
        scored_at: new Date().toISOString(),
        status: 'scored',
      };
      // Ingestion may already know the actor's contract type. A provider failure or
      // old-format response must not erase that deterministic source metadata.
      if (result.employment_type != null) scorePatch.employment_type = result.employment_type;
      // Legacy per-job company tier (pre-ADR 0107): the scorer no longer produces it,
      // and a rescore must not erase the value on rows that still carry one. The
      // per-company assessment (apply_channel/company_trust) is stamped separately.
      if (result.company_tier != null) {
        scorePatch.company_tier = result.company_tier;
        scorePatch.company_tier_note = result.company_tier_note ?? null;
      }

      const { error } = await supabaseAdmin()
        .from('jobs')
        .update(scorePatch)
        .eq('id', job.id);
      if (error) throw new Error(`persist AI score: ${error.message}`);
      scored++;
    } catch (error) {
      console.error(`[score-runner] job ${job.id} failed:`, error instanceof Error ? error.message : String(error));
      errors++;
    }
  }

  // Warm the prompt cache before fanning out (ADR 0056): a cache entry only becomes
  // readable once the first response starts, so N parallel first requests would ALL
  // pay the full system+résumé price. Scoring the first row alone writes the cached
  // prefix; the concurrent pool then reads it. Costs one row of parallelism once.
  const queue = [...rows];
  if (queue.length > 1) {
    const first = queue.shift();
    if (first) await processRow(first);
  }

  // Bounded-concurrency pool: up to SCORE_CONCURRENCY rows in flight at once. Workers
  // pull from a shared queue until it's drained.
  const runWorker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      await processRow(job);
    }
  };
  await Promise.all(Array.from({ length: Math.min(SCORE_CONCURRENCY, queue.length) }, runWorker));

  return { scored, filtered, errors };
}
