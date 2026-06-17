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
import { makeClient } from '@/lib/llm';
import { getActiveApiKey, isApiKeyProvider } from '@/lib/credentials';
import { supabaseAdmin } from '@/lib/supabase';
import {
  getSettings,
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

  // Build the LLM client from the active vault key for the configured provider
  // (ADR 0006). If no key resolves (vault empty + no env var), fall back to the
  // env-detected singleton inside scoreJob by leaving `client` undefined.
  const settings = await getSettings();
  let client = undefined;
  if (isApiKeyProvider(settings.llm_provider)) {
    const key = await getActiveApiKey(settings.llm_provider);
    if (key) client = makeClient(settings.llm_provider, settings.llm_model, key);
  }

  let scored = 0;
  let errors = 0;

  for (const job of batch) {
    const result = await scoreJob(
      resume,
      {
        title: job.title,
        company: job.company,
        location: job.location,
        full_description: job.full_description,
      },
      client,
    );
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
