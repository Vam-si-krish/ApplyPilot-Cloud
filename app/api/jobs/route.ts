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
  const opened = url.searchParams.get('opened');
  const companyTier = url.searchParams.get('companyTier');
  const runId = url.searchParams.get('runId');
  const recency = url.searchParams.get('recency'); // 'recent' (≤24h) | 'past' (>24h)
  const order = url.searchParams.get('order'); // 'date' → newest first (for the date-grouped Past view)
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
  // 'opened' = link clicked but not yet marked applied (where the user left off).
  if (opened === 'true') q = q.not('clicked_at', 'is', null).is('applied_at', null);
  if (companyTier) q = companyTier.includes(',') ? q.in('company_tier', companyTier.split(',')) : q.eq('company_tier', companyTier);
  if (runId) {
    if (runId.includes(',')) {
      q = q.in('run_id', runId.split(','));
    } else {
      q = q.eq('run_id', runId);
    }
  }
  // Recency split: the main page shows the last 24h; older jobs live in "Past Jobs".
  if (recency === 'recent' || recency === 'past') {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    q = recency === 'recent' ? q.gte('discovered_at', cutoff) : q.lt('discovered_at', cutoff);
  }

  // Past view groups by date → order newest-first; default view sorts by fit.
  if (order === 'date') {
    q = q.order('discovered_at', { ascending: false }).order('fit_score', { ascending: false, nullsFirst: false });
  } else {
    q = q.order('fit_score', { ascending: false, nullsFirst: false }).order('discovered_at', { ascending: false });
  }
  q = q.range(offset, offset + limit - 1);

  const { data, error, count } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ jobs: data ?? [], total: count ?? 0 });
}
