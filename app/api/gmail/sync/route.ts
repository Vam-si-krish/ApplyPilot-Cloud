/**
 * POST/GET /api/gmail/sync — headless orchestrator for the two-phase sync
 * (ADR 0013), driven by cron (every 30 min) and usable as a manual fallback.
 *
 * It runs fetch chunks until the look-back window is fully stored, then classify
 * chunks until the pending queue drains — all within one invocation, bounded by a
 * time budget so it stays under the serverless limit. Whatever it can't finish is
 * picked up by the next cron tick (fetch resumes from the remaining fresh ids;
 * classification resumes from status='pending'), so nothing is ever skipped.
 *
 * The Inbox "Sync now" button does NOT use this — it drives /api/gmail/fetch and
 * /api/gmail/classify-batch directly so it can render live progress.
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { checkCronAuth, verifySessionToken, SESSION_COOKIE } from '@/lib/auth';
import { resolveGmailContext, fetchChunk, classifyChunk } from '@/lib/mailSync';

export const runtime = 'nodejs';
export const maxDuration = 60;

const TIME_BUDGET_MS = 50_000; // leave headroom under maxDuration
const MAX_ITERS = 40; // safety cap per phase

async function handle(req: Request) {
  const sessionOk = await verifySessionToken(cookies().get(SESSION_COOKIE)?.value);
  if (!checkCronAuth(req) && !sessionOk) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const started = Date.now();
  const budgetLeft = () => Date.now() - started < TIME_BUDGET_MS;

  try {
    const { ctx, reason } = await resolveGmailContext();
    if (!ctx) return NextResponse.json({ ok: false, reason });

    // Phase 1 — fetch the whole window into the DB as 'pending'.
    let fetched = 0;
    let found = 0;
    let fetchDone = false;
    for (let i = 0; i < MAX_ITERS && budgetLeft(); i++) {
      const r = await fetchChunk(ctx);
      fetched += r.fetched;
      found = r.found;
      if (r.done) {
        fetchDone = true;
        break;
      }
    }

    // Phase 2 — classify pending messages until drained (or out of budget).
    let classified = 0;
    let remaining = 0;
    for (let i = 0; i < MAX_ITERS && budgetLeft(); i++) {
      const r = await classifyChunk();
      classified += r.classified;
      remaining = r.remaining;
      if (r.done) break;
    }

    return NextResponse.json({ ok: true, found, fetched, classified, remaining, fetchDone });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
