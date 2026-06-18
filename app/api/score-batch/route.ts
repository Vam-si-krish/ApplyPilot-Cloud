/**
 * POST /api/score-batch — score one chunk of unscored jobs, then re-trigger
 * itself until the queue drains (ADR 0004). Authorized by CRON_SECRET.
 *
 * One LLM call per job; a parse failure or LLM error yields score 0 (visible),
 * never a fabricated score. score==0 is counted as an error for the run log,
 * mirroring ApplyPilot-Lite.
 */
import { NextResponse } from 'next/server';
import { checkCronAuth } from '@/lib/auth';
import { buildScoringClient, scoreJobRows } from '@/lib/scoreRunner';
import {
  getSettings,
  getResumeText,
  getUnscoredBatch,
  countUnscored,
  getLatestRunningRun,
  bumpRunScored,
  finalizeRun,
} from '@/lib/db';
import { SCORE_BATCH_SIZE, triggerScoreBatch, triggerAssessBatch } from '@/lib/pipeline';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request) {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const settings = await getSettings();
  const running = await getLatestRunningRun();

  const batch = await getUnscoredBatch(SCORE_BATCH_SIZE);
  if (batch.length === 0) {
    if (running) await finalizeRun(running.id, 'succeeded');
    // Scoring done → kick the company-assessment stage (ADR 0010).
    if (settings.auto_assess_enabled) triggerAssessBatch();
    return NextResponse.json({ ok: true, scored: 0, done: true });
  }

  const resume = await getResumeText();
  const client = await buildScoringClient(settings);

  const { scored, filtered, errors } = await scoreJobRows(batch, {
    resume,
    client,
    prefilterThreshold: settings.prefilter_enabled ? settings.prefilter_threshold : null,
  });

  if (running) await bumpRunScored(running.id, scored, errors);

  const remaining = await countUnscored();
  if (remaining > 0) {
    triggerScoreBatch();
    return NextResponse.json({ ok: true, scored, filtered, remaining });
  }

  if (running) await finalizeRun(running.id, 'succeeded');
  // Scoring complete → kick the company-assessment stage for high scorers (ADR 0010).
  if (settings.auto_assess_enabled) triggerAssessBatch();
  return NextResponse.json({ ok: true, scored, filtered, remaining: 0, done: true });
}
