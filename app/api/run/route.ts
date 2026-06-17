/**
 * POST /api/run — start a daily (or manual) discovery run.
 *
 * Starts the Apify actor ASYNC and registers a webhook; never blocks on the
 * scrape (ADR 0004). Authorized by either the cron secret (Vercel Cron) or a
 * valid session cookie (manual "Run now" from the UI).
 */
import { NextResponse } from 'next/server';
import { startActorRun } from '@/lib/apify';
import { getSettings, createRun } from '@/lib/db';
import { checkCronAuth, verifySessionToken, SESSION_COOKIE } from '@/lib/auth';
import { appBaseUrl } from '@/lib/pipeline';
import { cookies } from 'next/headers';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(req: Request) {
  const sessionOk = verifySessionToken(cookies().get(SESSION_COOKIE)?.value);
  if (!checkCronAuth(req) && !sessionOk) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  }

  try {
    const settings = await getSettings();
    const webhookUrl = `${appBaseUrl()}/api/apify-webhook?secret=${encodeURIComponent(secret)}`;
    const { runId } = await startActorRun(settings, webhookUrl);
    await createRun(runId);
    return NextResponse.json({ ok: true, apify_run_id: runId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
