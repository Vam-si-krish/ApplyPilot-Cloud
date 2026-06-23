/**
 * POST /api/score-batch — score one chunk of unscored jobs, then re-trigger itself
 * until the queue drains (ADR 0004). Single-flight via the scoring_state lock
 * (ADR 0028): exactly one chain runs at a time, so concurrent triggers (multi-portal
 * webhooks, the manual button, overlapping runs) can't score the same job twice.
 * Authorized by CRON_SECRET.
 *
 *   no ?token  → START: acquire the lock (no-op if a chain is already active)
 *   ?token=…   → CONTINUE: drive the owning session's next batch
 *
 * One LLM call per job; a parse failure or LLM error yields score 0 (visible),
 * never a fabricated score. The session's done/total power the UI progress bar, and
 * stop_requested halts the loop after the current batch without losing scored work.
 */
import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
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
  acquireScoringLock,
  touchScoringSession,
  updateScoringProgress,
  releaseScoringLock,
  consumeScoringRescan,
  requestScoringRescan,
} from '@/lib/db';
import { SCORE_BATCH_SIZE, triggerScoreBatch, triggerAssessBatch } from '@/lib/pipeline';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** Close out a finished/stopped session: finalize the run + kick company assessment. */
async function finishUp(settings: Awaited<ReturnType<typeof getSettings>>): Promise<void> {
  const running = await getLatestRunningRun();
  if (running) await finalizeRun(running.id, 'succeeded').catch(() => {});
  if (settings.auto_assess_enabled) triggerAssessBatch();
}

export async function POST(req: Request) {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const settings = await getSettings();
  const incoming = new URL(req.url).searchParams.get('token');

  // ── Resolve the owning session ────────────────────────────────────────────
  let token: string;
  let baseDone: number;
  let baseErrors: number;

  if (!incoming) {
    // START: nothing to do if the queue is empty; otherwise try to acquire the lock.
    const total = await countUnscored();
    if (total === 0) {
      await finishUp(settings);
      return NextResponse.json({ ok: true, scored: 0, done: true });
    }
    token = randomUUID();
    const acquired = await acquireScoringLock(total, token);
    if (!acquired) {
      // A chain is already scoring — tell it to re-scan before it exits so the rows
      // this trigger cares about aren't orphaned, then no-op (no duplicate chain).
      await requestScoringRescan().catch(() => {});
      return NextResponse.json({ ok: true, skipped: 'already_running' });
    }
    baseDone = 0;
    baseErrors = 0;
  } else {
    // CONTINUE: validate token + refresh heartbeat; halt if superseded or stopped.
    const st = await touchScoringSession(incoming);
    if (!st) return NextResponse.json({ ok: true, halted: 'superseded' });
    if (st.stop_requested) {
      await releaseScoringLock(incoming);
      return NextResponse.json({ ok: true, stopped: true });
    }
    token = incoming;
    baseDone = st.done;
    baseErrors = st.errors;
  }

  // ── Score one batch ───────────────────────────────────────────────────────
  const running = await getLatestRunningRun();
  const batch = await getUnscoredBatch(SCORE_BATCH_SIZE);

  if (batch.length === 0) {
    // Queue empty: if new rows arrived mid-session, keep going; else release + finish.
    if (await consumeScoringRescan(token)) {
      const more = await countUnscored();
      if (more > 0) {
        await updateScoringProgress(token, baseDone, baseErrors, baseDone + more);
        triggerScoreBatch(token);
        return NextResponse.json({ ok: true, rescanned: true, remaining: more });
      }
    }
    await releaseScoringLock(token);
    await finishUp(settings);
    return NextResponse.json({ ok: true, done: true });
  }

  const resume = await getResumeText();
  const client = await buildScoringClient(settings);

  const { scored, filtered, errors } = await scoreJobRows(batch, {
    resume,
    client,
    prefilterThreshold: settings.prefilter_enabled ? settings.prefilter_threshold : null,
    skillMatchThreshold: settings.min_skill_match > 0 ? settings.min_skill_match : null,
  });

  const done = baseDone + scored + filtered;
  await updateScoringProgress(token, done, baseErrors + errors);
  if (running) await bumpRunScored(running.id, scored, errors);

  // ── Continue or finish ────────────────────────────────────────────────────
  const remaining = await countUnscored();
  if (remaining > 0) {
    // The stop flag is checked at the next CONTINUE's entry, so stopping costs ≤1 batch.
    triggerScoreBatch(token);
    return NextResponse.json({ ok: true, scored, filtered, done, remaining });
  }

  if (await consumeScoringRescan(token)) {
    const more = await countUnscored();
    if (more > 0) {
      await updateScoringProgress(token, done, baseErrors + errors, done + more);
      triggerScoreBatch(token);
      return NextResponse.json({ ok: true, scored, filtered, done, rescanned: true, remaining: more });
    }
  }

  await releaseScoringLock(token);
  await finishUp(settings);
  return NextResponse.json({ ok: true, scored, filtered, done, remaining: 0, done_all: true });
}
