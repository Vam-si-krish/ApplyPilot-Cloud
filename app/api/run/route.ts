/**
 * /api/run — start a daily (or manual) discovery run.
 *
 * Starts the Apify actor ASYNC and registers a webhook; never blocks on the
 * scrape (ADR 0004).
 *
 * - GET  is how Vercel Cron triggers it (cron sends Authorization: Bearer
 *   CRON_SECRET automatically when CRON_SECRET is set).
 * - POST is the manual "Run now" button (authorized by the session cookie).
 */
import { NextResponse } from 'next/server';
import { startAllPortalRuns } from '@/lib/apify';
import { rotateAllActiveKeys } from '@/lib/credentials';
import { getSettings, createRun } from '@/lib/db';
import { checkCronAuth, verifySessionToken, SESSION_COOKIE } from '@/lib/auth';
import { appBaseUrl } from '@/lib/pipeline';
import { cookies } from 'next/headers';

export const runtime = 'nodejs';
export const maxDuration = 30;

async function handle(req: Request) {
  const sessionOk = await verifySessionToken(cookies().get(SESSION_COOKIE)?.value);
  if (!checkCronAuth(req) && !sessionOk) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  }

  try {
    const settings = await getSettings();

    // If triggered by cron and auto_scrape is disabled, skip running
    if (checkCronAuth(req) && settings.auto_scrape_enabled === false) {
      return NextResponse.json({ ok: true, skipped: true, reason: 'auto_scrape_enabled is false' });
    }

    // Auto-rotate (ADR 0007): advance each provider's active key once, before the
    // run reads the Apify token (here) or the LLM key (later, in /api/score-batch).
    if (settings.auto_rotate_keys) await rotateAllActiveKeys();

    const webhookUrl = `${appBaseUrl()}/api/apify-webhook?secret=${encodeURIComponent(secret)}`;
    // Start one actor per enabled portal in parallel; create a run row per actor.
    const runs = await startAllPortalRuns(settings, webhookUrl);
    await Promise.all(runs.map((r) => createRun(r.runId)));
    return NextResponse.json({ ok: true, apify_run_ids: runs.map((r) => r.runId) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
