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
import { assessCompany } from '@/lib/companyCheck';
import { supabaseAdmin } from '@/lib/supabase';
import { getSettings, getUnassessedHighScoreBatch, countUnassessedHighScore } from '@/lib/db';
import { ASSESS_BATCH_SIZE, triggerAssessBatch } from '@/lib/pipeline';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request) {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const settings = await getSettings();
  const minScore = settings.auto_assess_min_score ?? 6;

  const batch = await getUnassessedHighScoreBatch(minScore, ASSESS_BATCH_SIZE);
  if (batch.length === 0) {
    return NextResponse.json({ ok: true, assessed: 0, done: true });
  }

  const client = await buildScoringClient(settings);

  let assessed = 0;
  for (const job of batch) {
    const { tier, note } = await assessCompany(job, client);
    const { error } = await supabaseAdmin()
      .from('jobs')
      .update({ company_tier: tier, company_tier_note: note })
      .eq('id', job.id);
    if (!error) assessed++;
  }

  const remaining = await countUnassessedHighScore(minScore);
  if (remaining > 0) {
    triggerAssessBatch();
    return NextResponse.json({ ok: true, assessed, remaining });
  }
  return NextResponse.json({ ok: true, assessed, remaining: 0, done: true });
}
