/**
 * POST /api/score-start — manually (re)start the scoring loop for any jobs still
 * 'unscored'. Recovers from a stalled auto-loop (ADR 0004) where a dropped
 * self-trigger left jobs unscored with no way to resume.
 *
 * Session-gated: it's not in middleware's PUBLIC/SELF_AUTH paths, so the password
 * session is required. It just fires the existing chunked scorer (which authorizes
 * itself with CRON_SECRET) and returns how many jobs are waiting.
 */
import { NextResponse } from 'next/server';
import { countUnscored } from '@/lib/db';
import { triggerScoreBatch } from '@/lib/pipeline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  const unscored = await countUnscored();
  if (unscored > 0) triggerScoreBatch();
  return NextResponse.json({ ok: true, unscored, started: unscored > 0 });
}
