/** GET /api/stats — dashboard counts, score distribution, and last run. */
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const db = supabaseAdmin();
  // Dashboard statistics describe the scraped Jobs workspace. Manual Tailor & Apply
  // rows are intentionally hidden there and must not inflate "scored" or "to score".
  const head = () => db
    .from('jobs')
    .select('id', { count: 'exact', head: true })
    .or('source.is.null,source.neq.manual');

  const [totalR, scoredR, shortlistedR, unscoredR, filteredR, appliedR] = await Promise.all([
    head().neq('status', 'archived').neq('status', 'filtered'),
    // A score of 0 is a visible terminal AI result; NULL means no AI score, regardless
    // of a legacy/bad status value.
    head().eq('status', 'scored').not('fit_score', 'is', null),
    head().eq('is_shortlisted', true),
    head().eq('status', 'unscored'),
    head().eq('status', 'filtered'),
    head().not('applied_at', 'is', null),
  ]);
  const total = totalR.count ?? 0;
  const scored = scoredR.count ?? 0;
  const shortlisted = shortlistedR.count ?? 0;
  const unscored = unscoredR.count ?? 0;
  const filtered = filteredR.count ?? 0;
  const applied = appliedR.count ?? 0;

  // Score distribution (scored jobs grouped by fit_score).
  const { data: scoredRows } = await db
    .from('jobs')
    .select('fit_score')
    .or('source.is.null,source.neq.manual')
    .not('fit_score', 'is', null);
  const distMap = new Map<number, number>();
  for (const r of scoredRows ?? []) {
    const s = (r as { fit_score: number }).fit_score;
    distMap.set(s, (distMap.get(s) ?? 0) + 1);
  }
  const score_distribution = Array.from(distMap.entries()).sort((a, b) => b[0] - a[0]);

  const { data: lastRun } = await db
    .from('runs')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return NextResponse.json({ total, scored, shortlisted, unscored, filtered, applied, score_distribution, last_run: lastRun ?? null });
}
