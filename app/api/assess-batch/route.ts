/**
 * POST /api/assess-batch — the post-scoring company-assessment stage (ADR 0010).
 * Authorized by CRON_SECRET. Triggered by /api/score-batch once scoring drains.
 *
 * Assesses the companies behind high-scoring jobs (fit_score >= the configured
 * threshold) that haven't been assessed yet, in chunks, re-triggering itself
 * until none remain. Separate LLM call per job (assessCompany) — does NOT touch
 * the frozen fit-scoring path.
 */
import { NextResponse } from 'next/server';
import { checkCronAuth } from '@/lib/auth';
import { buildScoringClient } from '@/lib/scoreRunner';
import { assessCompanyRows } from '@/lib/companyCheck';
import {
  getSettings,
  getUnassessedHighScoreBatch,
  countUnassessedHighScore,
  archiveAtOrBelowScore,
  getTopJobsForTailoring,
  addApplications,
} from '@/lib/db';
import { ASSESS_BATCH_SIZE, triggerAssessBatch } from '@/lib/pipeline';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Auto-pipeline finish (ADR 0044), run once when company assessment drains: send the top-N
 * surviving jobs (good/medium/unknown-company, highest fit_score) to Tailor & Apply as
 * 'queued' applications. The overnight tailoring queue (ADR 0043) then auto-tailors them.
 * Idempotent — addApplications upserts on job_id and ignores duplicates, so a re-run won't
 * double-queue. Gated by auto_pipeline_enabled.
 */
async function finishPipeline(settings: Awaited<ReturnType<typeof getSettings>>): Promise<void> {
  if (!settings.auto_pipeline_enabled) return;
  const topN = settings.pipeline_top_n > 0 ? settings.pipeline_top_n : 50;
  const ids = await getTopJobsForTailoring(topN).catch(() => [] as string[]);
  if (ids.length === 0) return;
  const added = await addApplications(ids).catch(() => 0);
  console.log(`[pipeline] sent ${added}/${ids.length} top jobs to Tailor & Apply (queued)`);
}

export async function POST(req: Request) {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const settings = await getSettings();
  const minScore = settings.auto_assess_min_score ?? 6;

  // Auto-pipeline stage 4 (ADR 0044): archive scored jobs at/below the cutoff (e.g. ≤ 5)
  // BEFORE assessing, so company-assessment LLM calls are spent only on survivors. Runs at
  // the start of the assess chain; idempotent (only touches scored rows ≤ cutoff). The
  // existing assess-min-score gate is separate — this archives the genuinely-low scorers.
  if (settings.auto_pipeline_enabled) {
    const archived = await archiveAtOrBelowScore(settings.pipeline_score_cutoff ?? 5).catch(() => 0);
    if (archived > 0) console.log(`[pipeline] archived ${archived} jobs scoring ≤ ${settings.pipeline_score_cutoff ?? 5}`);
  }

  const batch = await getUnassessedHighScoreBatch(minScore, ASSESS_BATCH_SIZE);
  if (batch.length === 0) {
    // Nothing left to assess → the chain is done; run the pipeline finish (top-N → Tailor).
    await finishPipeline(settings);
    return NextResponse.json({ ok: true, assessed: 0, done: true });
  }

  const client = await buildScoringClient(settings);

  const { assessed, errors } = await assessCompanyRows(batch, client);

  const remaining = await countUnassessedHighScore(minScore);
  if (remaining > 0) {
    triggerAssessBatch();
    return NextResponse.json({ ok: true, assessed, errors, remaining });
  }
  // Assessment drained → finish the pipeline.
  await finishPipeline(settings);
  return NextResponse.json({ ok: true, assessed, errors, remaining: 0, done: true });
}
