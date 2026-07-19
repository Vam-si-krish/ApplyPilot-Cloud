/** GET /api/jobs — filtered, sorted job list (fit_score desc, then newest). */
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { duplicatePassesHideFilters, promoteVisibleDuplicateGroups } from '@/lib/jobFilterGroups';
import type { Job, DuplicateSibling } from '@/lib/types';

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
  const applyChannel = url.searchParams.get('applyChannel'); // ADR 0107: 'none' | value | comma-list
  const hideTimeWasters = url.searchParams.get('hideTimeWasters') === 'true';
  const employmentType = url.searchParams.get('employmentType'); // 'contract' | 'full_time' | …
  const runId = url.searchParams.get('runId');
  const recency = url.searchParams.get('recency'); // 'recent' (≤24h) | 'past' (>24h)
  const order = url.searchParams.get('order'); // 'date' → newest first (for the date-grouped Past view)
  const idsOnly = url.searchParams.get('idsOnly') === 'true'; // return every matching id (for "select all matching")
  const excludeApplied = url.searchParams.get('excludeApplied') === 'true';
  const excludeInApplications = url.searchParams.get('excludeInApplications') === 'true';
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
  // Unknown is not evidence of an external application. Keep it out of both explicit
  // apply-type filters, matching the UI's decision not to render a badge for NULL.
  if (easyApply === 'false') q = q.eq('easy_apply', false);
  if (applied === 'true') q = q.not('applied_at', 'is', null);

  // Resolve Tailor & Apply membership separately. Putting dozens of UUIDs into both a
  // NOT IN exclusion and the duplicate-group OR can exceed the gateway request limit;
  // exact UUID exclusions are therefore applied to the returned rows below.
  const applicationJobIds = new Set<string>();
  if (excludeInApplications) {
    const { data: appRows, error: appErr } = await supabaseAdmin().from('applications').select('job_id');
    if (appErr) return NextResponse.json({ error: appErr.message }, { status: 500 });
    const inApp = (appRows ?? []).map((r) => (r as { job_id: string | null }).job_id).filter((x): x is string => !!x);
    inApp.forEach((id) => applicationJobIds.add(id));
  }

  // Duplicate postings (ADR 0057): the main query stays compact and returns canonical
  // rows plus independently important duplicates. Hidden canonicals receive a bounded
  // replacement-location query after this result is known (ADR 0101).
  if (!runId) {
    q = q.or('duplicate_of.is.null,applied_at.not.is.null,is_shortlisted.eq.true,clicked_at.not.is.null');
  }
  // Optionally hide jobs you opened but didn't apply to (clicked_at set, not yet applied).
  if (url.searchParams.get('excludeOpened') === 'true') q = q.or('clicked_at.is.null,applied_at.not.is.null');
  // 'opened' = link clicked but not yet marked applied (where the user left off).
  if (opened === 'true') q = q.not('clicked_at', 'is', null).is('applied_at', null);
  // companyTier: 'none' → not yet assessed (company_tier IS NULL); else exact / comma-list.
  if (companyTier === 'none') q = q.is('company_tier', null);
  else if (companyTier) q = companyTier.includes(',') ? q.in('company_tier', companyTier.split(',')) : q.eq('company_tier', companyTier);
  // Per-company apply-channel verdict (ADR 0107). 'none' → company not yet assessed.
  if (applyChannel === 'none') q = q.is('apply_channel', null);
  else if (applyChannel) q = q.in('apply_channel', applyChannel.split(','));
  // "Hide time-wasters": drop intermediary-funnel postings and suspicious employers.
  // Unassessed (NULL) rows stay visible — hiding them would silently bury new
  // companies before their verdict exists. NOT IN excludes NULLs in SQL, hence the ORs.
  if (hideTimeWasters) {
    q = q
      .or('apply_channel.is.null,apply_channel.not.in.(aggregator,talent_marketplace,gig_platform)')
      .or('company_trust.is.null,company_trust.neq.suspicious');
  }
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

  const mainRows = (data ?? []) as Job[];
  const hideOptions = { excludeApplied, excludeInApplications, applicationJobIds };
  const hiddenCanonicalIds = new Set(
    mainRows
      .filter((job) => !job.duplicate_of && !duplicatePassesHideFilters(job, hideOptions))
      .map((job) => job.id),
  );
  const retainedRows = mainRows.filter((job) => duplicatePassesHideFilters(job, hideOptions));
  const replacementRows: Job[] = [];

  // If a filtered-out canonical has other locations, load those candidates in small
  // chunks and apply the same visible filters as the main query. This avoids long UUID
  // query strings while preserving search/status/score semantics for promoted rows.
  if (!runId && hiddenCanonicalIds.size > 0) {
    const hiddenIds = [...hiddenCanonicalIds];
    for (let index = 0; index < hiddenIds.length; index += 20) {
      let replacements = supabaseAdmin().from('jobs').select('*').in('duplicate_of', hiddenIds.slice(index, index + 20));
      if (status === 'all') replacements = replacements.neq('status', 'archived').neq('status', 'filtered');
      else replacements = replacements.eq('status', status);
      replacements = replacements.or('source.is.null,source.neq.manual');
      if (search) replacements = replacements.or(`title.ilike.%${search}%,company.ilike.%${search}%,location.ilike.%${search}%`);
      if (minScore !== null && minScore !== '') replacements = replacements.gte('fit_score', Number(minScore));
      if (maxScore !== null && maxScore !== '') replacements = replacements.lte('fit_score', Number(maxScore));
      if (minSkill !== null && minSkill !== '') replacements = replacements.gte('skill_match_score', Number(minSkill));
      if (maxSkill !== null && maxSkill !== '') replacements = replacements.lte('skill_match_score', Number(maxSkill));
      if (minMatch !== null && minMatch !== '') replacements = replacements.gte('prefilter_score', Number(minMatch));
      if (maxMatch !== null && maxMatch !== '') replacements = replacements.lte('prefilter_score', Number(maxMatch));
      if (shortlisted === 'true') replacements = replacements.eq('is_shortlisted', true);
      if (easyApply === 'true') replacements = replacements.eq('easy_apply', true);
      if (easyApply === 'false') replacements = replacements.eq('easy_apply', false);
      if (applied === 'true') replacements = replacements.not('applied_at', 'is', null);
      if (url.searchParams.get('excludeOpened') === 'true') replacements = replacements.or('clicked_at.is.null,applied_at.not.is.null');
      if (opened === 'true') replacements = replacements.not('clicked_at', 'is', null).is('applied_at', null);
      if (companyTier === 'none') replacements = replacements.is('company_tier', null);
      else if (companyTier) replacements = companyTier.includes(',') ? replacements.in('company_tier', companyTier.split(',')) : replacements.eq('company_tier', companyTier);
      if (employmentType) replacements = replacements.eq('employment_type', employmentType);
      if (recency === 'recent' || recency === 'past') {
        const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        replacements = recency === 'recent' ? replacements.gte('discovered_at', cutoff) : replacements.lt('discovered_at', cutoff);
      }
      const { data: candidates, error: replacementError } = await replacements.limit(1000);
      if (replacementError) return NextResponse.json({ error: replacementError.message }, { status: 500 });
      replacementRows.push(...((candidates ?? []) as Job[]).filter((job) => duplicatePassesHideFilters(job, hideOptions)));
    }
  }

  // Attach each canonical row's duplicate variants (ADR 0057) so the UI can show
  // "+N locations" and let the user open/apply to a specific one.
  const uniqueRows = [...new Map([...retainedRows, ...replacementRows].map((job) => [job.id, job])).values()];
  const grouped = !runId
    ? promoteVisibleDuplicateGroups(uniqueRows, hiddenCanonicalIds)
    : { rows: uniqueRows, canonicalGroupByRepresentative: new Map<string, string>(), collapsedCount: 0 };
  const jobs = grouped.rows;
  const groupKeyByRepresentative = new Map<string, string>();
  for (const job of jobs) {
    if (!job.duplicate_of) groupKeyByRepresentative.set(job.id, grouped.canonicalGroupByRepresentative.get(job.id) ?? job.id);
  }
  const canonicalIds = [...new Set(groupKeyByRepresentative.values())];
  if (canonicalIds.length > 0) {
    const { data: sibs } = await supabaseAdmin()
      .from('jobs')
      .select('id, duplicate_of, location, url, application_url, status, applied_at')
      .in('duplicate_of', canonicalIds);
    if (sibs && sibs.length > 0) {
      const byCanonical = new Map<string, DuplicateSibling[]>();
      for (const s of sibs as (DuplicateSibling & { duplicate_of: string })[]) {
        if (!duplicatePassesHideFilters(s, { excludeApplied, excludeInApplications, applicationJobIds })) continue;
        const list = byCanonical.get(s.duplicate_of) ?? [];
        list.push({ id: s.id, location: s.location, url: s.url, application_url: s.application_url, status: s.status, applied_at: s.applied_at });
        byCanonical.set(s.duplicate_of, list);
      }
      for (const j of jobs) {
        const canonicalId = groupKeyByRepresentative.get(j.id);
        const list = canonicalId ? byCanonical.get(canonicalId)?.filter((s) => s.id !== j.id) : undefined;
        if (list) {
          // Remote first, then alphabetical — the order the user would pick from.
          list.sort((a, b) => {
            const ra = /remote/i.test(a.location || '') ? 0 : 1;
            const rb = /remote/i.test(b.location || '') ? 0 : 1;
            return ra - rb || (a.location || '').localeCompare(b.location || '');
          });
          j.siblings = list;
        }
      }
    }
  }

  const hiddenMainRows = mainRows.length - retainedRows.length;
  const promotedGroups = grouped.canonicalGroupByRepresentative.size;
  const adjustedTotal = (count ?? 0) <= limit
    ? jobs.length
    : Math.max(0, (count ?? 0) - hiddenMainRows + promotedGroups);
  return NextResponse.json({ jobs, total: adjustedTotal });
}
