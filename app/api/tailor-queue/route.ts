/**
 * /api/tailor-queue — kick off the overnight tailoring drain (ADR 0043).
 *
 * The user queues jobs in Tailor & Apply (status 'queued') through the day; the drain
 * tailors → scores → renders a PDF for each on the always-on worker, so they're ready by
 * morning and the heavy LLM usage is spent off the interactive Claude window.
 *
 * SCHEDULING NOTE: the app is deployed on **Netlify**, where `vercel.json` crons do NOT
 * fire. The real scheduled trigger is the always-on Worker Mac's launchd job, which calls
 * the worker's /tailor-queue DIRECTLY (hourly, with scheduled:true) — the worker self-gates
 * on the Settings (enabled + auto_tailor_time). This cloud route is therefore NOT the
 * primary scheduler; it exists for:
 *   - POST: the manual "Run queue now" button (session-gated) — drains immediately.
 *   - GET:  an OPTIONAL external/Netlify-scheduled trigger, if ever wired up. It forwards
 *           scheduled:true so the WORKER applies the enabled/hour gate (single source of
 *           truth — the schedule decision lives in one place, not duplicated here).
 *
 * Either way it never blocks on the work: it pings the worker (which acks 202 and drains
 * for many minutes in the background) and returns right away.
 */
import { NextResponse } from 'next/server';
import { getSettings } from '@/lib/db';
import { checkCronAuth, verifySessionToken, SESSION_COOKIE } from '@/lib/auth';
import { cookies } from 'next/headers';

export const runtime = 'nodejs';
export const maxDuration = 30;

async function handle(req: Request) {
  const isCron = checkCronAuth(req);
  const sessionOk = await verifySessionToken(cookies().get(SESSION_COOKIE)?.value);
  if (!isCron && !sessionOk) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let settings;
  try {
    settings = await getSettings();
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }

  const url = settings.resume_worker_url?.trim() || process.env.RESUME_WORKER_URL;
  const secret = settings.resume_worker_secret?.trim() || process.env.RESUME_WORKER_SECRET;
  if (!url || !secret) {
    return NextResponse.json(
      { error: 'Résumé worker not configured — set RESUME_WORKER_URL and RESUME_WORKER_SECRET.' },
      { status: 503 },
    );
  }

  try {
    const r = await fetch(`${url.replace(/\/$/, '')}/tailor-queue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
      // A cron GET forwards scheduled:true so the worker applies the enabled/hour gate;
      // a manual POST omits it, so "Run queue now" drains immediately.
      body: JSON.stringify(isCron ? { scheduled: true } : {}),
      // The worker acks (202) before draining, so this returns in ~1s.
      signal: AbortSignal.timeout(20_000),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return NextResponse.json({ error: data.error || `worker error (${r.status})` }, { status: r.status });
    }
    return NextResponse.json(
      { ok: true, skipped: data.skipped ?? false, queued: data.queued ?? null, processing: data.processing ?? null },
      { status: data.skipped ? 200 : 202 },
    );
  } catch (e) {
    const msg =
      e instanceof Error && e.name === 'TimeoutError'
        ? 'The résumé worker did not respond — is it running?'
        : e instanceof Error
          ? e.message
          : String(e);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

export const GET = handle;
export const POST = handle;
