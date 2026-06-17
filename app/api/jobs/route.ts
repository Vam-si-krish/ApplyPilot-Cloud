/** GET /api/jobs — filtered, sorted job list (fit_score desc, then newest). */
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const status = url.searchParams.get('status') || 'all';
  const search = url.searchParams.get('search') || '';
  const minScore = url.searchParams.get('minScore');
  const maxScore = url.searchParams.get('maxScore');
  const shortlisted = url.searchParams.get('shortlisted');
  const easyApply = url.searchParams.get('easyApply');
  const applied = url.searchParams.get('applied');
  const runId = url.searchParams.get('runId');
  const limit = Math.min(Number(url.searchParams.get('limit')) || 200, 1000);
  const offset = Number(url.searchParams.get('offset')) || 0;

  let q = supabaseAdmin().from('jobs').select('*', { count: 'exact' });

  // Default 'all' view hides archived and pre-filtered jobs; pick them explicitly to see them.
  if (status === 'all') q = q.neq('status', 'archived').neq('status', 'filtered');
  else q = q.eq('status', status);

  if (search) q = q.or(`title.ilike.%${search}%,company.ilike.%${search}%,location.ilike.%${search}%`);
  if (minScore !== null && minScore !== '') q = q.gte('fit_score', Number(minScore));
  if (maxScore !== null && maxScore !== '') q = q.lte('fit_score', Number(maxScore));
  if (shortlisted === 'true') q = q.eq('is_shortlisted', true);
  if (easyApply === 'true') q = q.eq('easy_apply', true);
  if (easyApply === 'false') q = q.eq('easy_apply', false);
  if (applied === 'true') q = q.not('applied_at', 'is', null);
  if (runId) q = q.eq('run_id', runId);

  q = q
    .order('fit_score', { ascending: false, nullsFirst: false })
    .order('discovered_at', { ascending: false })
    .range(offset, offset + limit - 1);

  const { data, error, count } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ jobs: data ?? [], total: count ?? 0 });
}
