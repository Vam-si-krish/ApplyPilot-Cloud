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
import { authorizedRouteUser } from '@/lib/routeUser';
import { runAsUser } from '@/lib/userContext';
import { workerRequestHeaders } from '@/lib/workerAuth';
import { resolveWorkerConfig } from '@/lib/workerConfig';

export const runtime = 'nodejs';
export const maxDuration = 30;

async function handle(req: Request) {
  const auth = await authorizedRouteUser(req);
  if (!auth) return NextResponse.json({ error: 'unauthorized or missing user_id' }, { status: 401 });
  return runAsUser(auth.userId, async () => {
  const isCron = auth.isCron;

  let settings;
  try {
    settings = await getSettings();
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }

  const worker = resolveWorkerConfig(settings);
  if (!worker) {
    return NextResponse.json(
      { error: 'Résumé worker not configured — set RESUME_WORKER_URL and RESUME_WORKER_SECRET.' },
      { status: 503 },
    );
  }

  try {
    const r = await fetch(`${worker.url}/tailor-queue`, {
      method: 'POST',
      headers: workerRequestHeaders(worker.secret),
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
  });
}

export const GET = handle;
export const POST = handle;
