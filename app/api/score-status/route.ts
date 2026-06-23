/**
 * GET /api/score-status — live state of the single-flight scorer (ADR 0028), for
 * the progress panel. Session-gated. Returns the session row plus the current
 * unscored count and a `stale` flag (active but heartbeat dead → presumed crashed).
 */
import { NextResponse } from 'next/server';
import { getScoringState, countUnscored, isScoringStale } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [s, remaining] = await Promise.all([getScoringState(), countUnscored()]);
    const stale = isScoringStale(s);
    return NextResponse.json({
      active: !!s?.active && !stale,
      stop_requested: !!s?.stop_requested,
      stale,
      total: s?.total ?? 0,
      done: s?.done ?? 0,
      errors: s?.errors ?? 0,
      started_at: s?.started_at ?? null,
      heartbeat: s?.heartbeat ?? null,
      remaining,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
