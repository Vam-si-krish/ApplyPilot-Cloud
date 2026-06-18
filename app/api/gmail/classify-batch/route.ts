/**
 * POST/GET /api/gmail/classify-batch — AI-classify one chunk of pending messages
 * (ADR 0013). The Inbox "Sync now" button calls this in a loop after fetching,
 * rendering live "Processing X of N" progress; the cron orchestrator reuses the
 * same engine. One LLM call per message; the frozen SCORE_PROMPT is untouched.
 * Session- or CRON_SECRET-authorized.
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { checkCronAuth, verifySessionToken, SESSION_COOKIE } from '@/lib/auth';
import { classifyChunk } from '@/lib/mailSync';

export const runtime = 'nodejs';
export const maxDuration = 60;

async function handle(req: Request) {
  const sessionOk = await verifySessionToken(cookies().get(SESSION_COOKIE)?.value);
  if (!checkCronAuth(req) && !sessionOk) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const result = await classifyChunk();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
