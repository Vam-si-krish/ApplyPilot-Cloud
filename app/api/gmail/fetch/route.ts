/**
 * POST/GET /api/gmail/fetch — pull one chunk of NEW Gmail messages into the DB as
 * 'pending' (headers + snippet, no AI yet) — ADR 0013. The Inbox "Sync now" button
 * calls this in a loop until { done: true }, showing live "N found" progress; the
 * cron orchestrator (/api/gmail/sync) reuses the same engine headlessly.
 *
 * last_synced_at advances only when the whole look-back window is stored, so no
 * mail is ever skipped by a per-run cap. Session- or CRON_SECRET-authorized.
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { checkCronAuth, verifySessionToken, SESSION_COOKIE } from '@/lib/auth';
import { resolveGmailContext, fetchChunk } from '@/lib/mailSync';

export const runtime = 'nodejs';
export const maxDuration = 60;

async function handle(req: Request) {
  const sessionOk = await verifySessionToken(cookies().get(SESSION_COOKIE)?.value);
  if (!checkCronAuth(req) && !sessionOk) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const { ctx, reason } = await resolveGmailContext();
    if (!ctx) return NextResponse.json({ ok: false, reason });
    const result = await fetchChunk(ctx);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
