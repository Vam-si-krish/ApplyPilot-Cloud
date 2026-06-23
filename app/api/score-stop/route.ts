/**
 * POST /api/score-stop — ask the active scoring chain to stop (ADR 0028).
 * Session-gated. Sets stop_requested; the chain halts after its current batch.
 * Already-scored jobs stay scored; the rest remain 'unscored' and resume next time.
 */
import { NextResponse } from 'next/server';
import { requestScoringStop } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    await requestScoringStop();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
