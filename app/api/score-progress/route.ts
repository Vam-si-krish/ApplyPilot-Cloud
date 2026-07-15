/**
 * POST /api/score-progress — how many of the given jobs have finished a DELEGATED batch.
 *
 * Session-gated (middleware). Used by the Jobs tab to drive the "Score selected" progress
 * toast when the work was DELEGATED to the worker (subscription mode, ADR 0042): the worker
 * writes results to Supabase in the background, so the client polls this to reflect real
 * progress instead of the (instant) delegation response. Lightweight — one narrow select,
 * no LLM, no writes. (Company assessment now rides the scoring call — ADR 0065 — so there is
 * no separate 'assess' mode to poll anymore.)
 *
 * Body: { ids: string[] } → { scored, total }: counts ids with a persisted numeric AI
 * score. Score 0 is terminal and visible; status alone is never proof of a score.
 */
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  let body: { ids?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === 'string') : [];
  if (ids.length === 0) return NextResponse.json({ scored: 0, total: 0 });

  const { data, error } = await supabaseAdmin().from('jobs').select('id, fit_score').in('id', ids);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = data ?? [];
  // Provider/parser failures persist score 0, so they still complete the poll without
  // conflating filtered/archived/status-corrupt rows with an AI result.
  const scored = rows.filter((r) => (r as { fit_score: number | null }).fit_score != null).length;
  return NextResponse.json({ scored, total: rows.length });
}
