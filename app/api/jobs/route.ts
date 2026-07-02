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
  const minSkill = url.searchParams.get('minSkill');
  const maxSkill = url.searchParams.get('maxSkill'); // e.g. 0 → "no skill match"
  const minMatch = url.searchParams.get('minMatch'); // ATS match % lower bound (ADR 0053)
  const maxMatch = url.searchParams.get('maxMatch'); // upper bound — isolates low-match jobs to delete
  const shortlisted = url.searchParams.get('shortlisted');
  const easyApply = url.searchParams.get('easyApply');
  const applied = url.searchParams.get('applied');
  const opened = url.searchParams.get('opened');
  const companyTier = url.searchParams.get('companyTier');
  const employmentType = url.searchParams.get('employmentType'); // 'contract' | 'full_time' | …
  const runId = url.searchParams.get('runId');
  const recency = url.searchParams.get('recency'); // 'recent' (≤24h) | 'past' (>24h)
  const order = url.searchParams.get('order'); // 'date' → newest first (for the date-grouped Past view)
  const idsOnly = url.searchParams.get('idsOnly') === 'true'; // return every matching id (for "select all matching")
  const limit = Math.min(Number(url.searchParams.get('limit')) || 200, 1000);
  const offset = Number(url.searchParams.get('offset')) || 0;

  let q = idsOnly
    ? supabaseAdmin().from('jobs').select('id')
    : supabaseAdmin().from('jobs').select('*', { count: 'exact' });

  // Default 'all' view hides archived and pre-filtered jobs; pick them explicitly to see them.
  if (status === 'all') q = q.neq('status', 'archived').neq('status', 'filtered');
  else q = q.eq('status', status);

  // Manually-added jobs live only under Tailor & Apply (ADR 0034) — keep them out of the
  // scraped Jobs list. (source IS NULL covers normal scraped rows.)
  q = q.or('source.is.null,source.neq.manual');

  if (search) q = q.or(`title.ilike.%${search}%,company.ilike.%${search}%,location.ilike.%${search}%`);
  if (minScore !== null && minScore !== '') q = q.gte('fit_score', Number(minScore));
  if (maxScore !== null && maxScore !== '') q = q.lte('fit_score', Number(maxScore));
  if (minSkill !== null && minSkill !== '') q = q.gte('skill_match_score', Number(minSkill));
  // maxSkill (incl. 0) filters by upper bound; lte excludes NULLs, so maxSkill=0 = "matched none of my skills".
  if (maxSkill !== null && maxSkill !== '') q = q.lte('skill_match_score', Number(maxSkill));
  if (minMatch !== null && minMatch !== '') q = q.gte('prefilter_score', Number(minMatch));
  if (maxMatch !== null && maxMatch !== '') q = q.lte('prefilter_score', Number(maxMatch));
  if (shortlisted === 'true') q = q.eq('is_shortlisted', true);
  if (easyApply === 'true') q = q.eq('easy_apply', true);
  if (easyApply === 'false') q = q.eq('easy_apply', false);
  if (applied === 'true') q = q.not('applied_at', 'is', null);
  // Keep jobs you've already applied to out of the working list (they live under the Applied tab).
  if (url.searchParams.get('excludeApplied') === 'true') q = q.is('applied_at', null);
  // Keep jobs already queued for tailoring out of the working list — once you "Add to
  // Applications" they live under Tailor & Apply, so they shouldn't linger here too.
  // Anti-join: pull the job_ids that already have an application row and exclude them.
  if (url.searchParams.get('excludeInApplications') === 'true') {
    const { data: appRows, error: appErr } = await supabaseAdmin().from('applications').select('job_id');
    if (appErr) return NextResponse.json({ error: appErr.message }, { status: 500 });
    const inApp = (appRows ?? []).map((r) => (r as { job_id: string | null }).job_id).filter((x): x is string => !!x);
    if (inApp.length > 0) q = q.not('id', 'in', `(${inApp.join(',')})`);
  }
  // Optionally hide jobs you opened but didn't apply to (clicked_at set, not yet applied).
  if (url.searchParams.get('excludeOpened') === 'true') q = q.or('clicked_at.is.null,applied_at.not.is.null');
  // 'opened' = link clicked but not yet marked applied (where the user left off).
  if (opened === 'true') q = q.not('clicked_at', 'is', null).is('applied_at', null);
  // companyTier: 'none' → not yet assessed (company_tier IS NULL); else exact / comma-list.
  if (companyTier === 'none') q = q.is('company_tier', null);
  else if (companyTier) q = companyTier.includes(',') ? q.in('company_tier', companyTier.split(',')) : q.eq('company_tier', companyTier);
  if (employmentType) q = q.eq('employment_type', employmentType);
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

  // "Select all matching": return every matching id (no pagination), for bulk actions.
  if (idsOnly) {
    const { data, error } = await q.limit(5000);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ids: (data ?? []).map((r) => (r as { id: string }).id) });
  }

  // Past view groups by date → order newest-first; 'match' sorts by the ATS match %
  // (the first-filter pass, before any fit_score exists); default sorts by fit.
  if (order === 'date') {
    q = q.order('discovered_at', { ascending: false }).order('fit_score', { ascending: false, nullsFirst: false });
  } else if (order === 'match') {
    q = q.order('prefilter_score', { ascending: false, nullsFirst: false }).order('discovered_at', { ascending: false });
  } else {
    q = q.order('fit_score', { ascending: false, nullsFirst: false }).order('discovered_at', { ascending: false });
  }
  q = q.range(offset, offset + limit - 1);

  const { data, error, count } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ jobs: data ?? [], total: count ?? 0 });
}
