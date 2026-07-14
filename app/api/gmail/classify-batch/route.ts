/**
 * POST/GET /api/gmail/classify-batch — AI-classify one chunk of pending messages
 * (ADR 0013). The Inbox "Sync now" button calls this in a loop after fetching,
 * rendering live "Processing X of N" progress; the cron orchestrator reuses the
 * same engine. One LLM call per message; the frozen SCORE_PROMPT is untouched.
 * Session- or CRON_SECRET-authorized.
 */
import { NextResponse } from 'next/server';
import { classifyChunk } from '@/lib/mailSync';
import { authorizedRouteUser } from '@/lib/routeUser';
import { runAsUser } from '@/lib/userContext';

export const runtime = 'nodejs';
export const maxDuration = 60;

async function handle(req: Request) {
  const auth = await authorizedRouteUser(req);
  if (!auth) return NextResponse.json({ error: 'unauthorized or missing user_id' }, { status: 401 });
  return runAsUser(auth.userId, async () => {

  try {
    const result = await classifyChunk();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
  });
}

export const GET = handle;
export const POST = handle;
