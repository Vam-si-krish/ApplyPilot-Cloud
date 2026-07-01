/**
 * POST /api/score-progress — how many of the given jobs have finished a DELEGATED batch.
 *
 * Session-gated (middleware). Used by the Jobs tab to drive the "Score selected" and
 * "Assess companies" progress toasts when the work was DELEGATED to the worker (subscription
 * mode, ADR 0042): the worker writes results to Supabase in the background, so the client
 * polls this to reflect real progress instead of the (instant) delegation response.
 * Lightweight — one narrow select, no LLM, no writes.
 *
 * Body: { ids: string[], mode?: 'score' | 'assess' } → { scored, total }:
 *  - 'score'  (default): counts ids that have left the 'unscored' status (scored / filtered
 *     / archived — all terminal).
 *  - 'assess': counts ids whose company_tier is now set (assessment written).
 */
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  let body: { ids?: unknown; mode?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === 'string') : [];
  const mode = body.mode === 'assess' ? 'assess' : 'score';
  if (ids.length === 0) return NextResponse.json({ scored: 0, total: 0 });

  const col = mode === 'assess' ? 'id, company_tier' : 'id, status';
  const { data, error } = await supabaseAdmin().from('jobs').select(col).in('id', ids);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = data ?? [];
  // 'assess': done = company_tier written (incl. a genuine/failed 'unknown', which is a real
  //   terminal result). 'score': done = left the 'unscored' queue. Either way, counting a
  //   terminal state (not "still pending") means the toast can't hang if a row errors.
  const scored =
    mode === 'assess'
      ? rows.filter((r) => (r as { company_tier: string | null }).company_tier != null).length
      : rows.filter((r) => (r as { status: string }).status !== 'unscored').length;
  return NextResponse.json({ scored, total: rows.length });
}
