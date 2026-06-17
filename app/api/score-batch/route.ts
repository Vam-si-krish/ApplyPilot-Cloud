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
import { scoreJob } from '@/lib/scoring';
import { supabaseAdmin } from '@/lib/supabase';
import {
  getResumeText,
  getUnscoredBatch,
  countUnscored,
  getLatestRunningRun,
  bumpRunScored,
  finalizeRun,
} from '@/lib/db';
import { SCORE_BATCH_SIZE, triggerScoreBatch } from '@/lib/pipeline';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request) {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const running = await getLatestRunningRun();

  const batch = await getUnscoredBatch(SCORE_BATCH_SIZE);
  if (batch.length === 0) {
    if (running) await finalizeRun(running.id, 'succeeded');
    return NextResponse.json({ ok: true, scored: 0, done: true });
  }

  const resume = await getResumeText();
  let scored = 0;
  let errors = 0;

  for (const job of batch) {
    const result = await scoreJob(resume, {
      title: job.title,
      company: job.company,
      location: job.location,
      full_description: job.full_description,
    });
    if (result.score === 0) errors++;

    const { error } = await supabaseAdmin()
      .from('jobs')
      .update({
        fit_score: result.score,
        score_note: result.note,
        score_keywords: result.keywords,
        score_reasoning: result.reasoning,
        scored_at: new Date().toISOString(),
        status: 'scored',
      })
      .eq('id', job.id);
    if (!error) scored++;
  }

  if (running) await bumpRunScored(running.id, scored, errors);

  const remaining = await countUnscored();
  if (remaining > 0) {
    triggerScoreBatch();
    return NextResponse.json({ ok: true, scored, remaining });
  }

  if (running) await finalizeRun(running.id, 'succeeded');
  return NextResponse.json({ ok: true, scored, remaining: 0, done: true });
}
