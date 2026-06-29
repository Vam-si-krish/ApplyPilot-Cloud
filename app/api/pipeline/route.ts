/**
 * GET /api/pipeline — funnel + live-step view of the auto-pipeline (ADR 0044/0045).
 * Session-gated. Assembles per-stage counts from existing data (no schema change):
 *
 *   Fetched → [skill gate] → Scored → [≤cutoff cut] → Survivors → Assessed → Top-N → Queued
 *
 * Archive reason is INFERRED, since the pipeline doesn't store it: an archived job with a
 * null fit_score was culled at the skill gate (never scored); one with a fit_score was culled
 * by the score cut. The live "current stage" comes from scoring_state (the single-flight
 * scorer, ADR 0028) and the unassessed-queue count.
 */
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSettings, getScoringState, isScoringStale, getLatestRunningRun } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = supabaseAdmin();
    const settings = await getSettings();
    const cutoff = settings.pipeline_score_cutoff ?? 5;
    const assessMin = settings.auto_assess_min_score ?? 6;

    const head = () => db.from('jobs').select('id', { count: 'exact', head: true });
    const appHead = () => db.from('applications').select('id', { count: 'exact', head: true });

    const [
      scoredR,            // scored survivors (status scored)
      unscoredR,          // still awaiting scoring
      archivedNoScoreR,   // archived before scoring → skill gate
      archivedScoredR,    // archived after scoring → ≤ cutoff cut
      survivorsHighR,     // scored survivors at/above the assess-min (assessment candidates)
      assessedR,          // survivors whose company has been assessed
      lowTierR,           // survivors at a 'low'-tier company (excluded from Top-N)
      queuedAppsR,        // applications queued in Tailor & Apply
      tailoredAppsR,      // applications already tailored (status ready/applied)
    ] = await Promise.all([
      head().eq('status', 'scored'),
      head().eq('status', 'unscored'),
      head().eq('status', 'archived').is('fit_score', null),
      head().eq('status', 'archived').not('fit_score', 'is', null),
      head().eq('status', 'scored').gte('fit_score', assessMin),
      head().eq('status', 'scored').not('company_tier', 'is', null),
      head().eq('status', 'scored').eq('company_tier', 'low'),
      appHead().eq('status', 'queued'),
      appHead().in('status', ['ready', 'applied']),
    ]);

    const scored = scoredR.count ?? 0;
    const unscored = unscoredR.count ?? 0;
    const archivedNoSkill = archivedNoScoreR.count ?? 0;
    const archivedLowScore = archivedScoredR.count ?? 0;
    const assessCandidates = survivorsHighR.count ?? 0;
    const assessed = assessedR.count ?? 0;
    const lowTier = lowTierR.count ?? 0;
    const queued = queuedAppsR.count ?? 0;
    const tailored = tailoredAppsR.count ?? 0;

    // Derived: everything that ever entered scoring, and the eligible Top-N pool.
    const fetched = unscored + scored + archivedNoSkill + archivedLowScore;
    const eligibleForTailor = Math.max(0, scored - lowTier); // good/medium/unknown survivors

    // ── Live current stage ──────────────────────────────────────────────────
    // A stage is "running" ONLY when there's a genuine, fresh activity signal:
    //   - an active Apify scrape (a runs row 'running', younger than 2h — older = orphaned), or
    //   - the single-flight scorer holding a NON-stale lock (heartbeat within 120s).
    // Assessment and tailoring have no equivalent "am I running" flag, and unfinished work
    // (unscored rows, unassessed companies, queued apps) is just BACKLOG, not activity — so it
    // must NOT be reported as a running stage. When nothing is genuinely running we report
    // 'idle' and describe the backlog separately, so the UI never implies a run is happening
    // when it isn't. (This is why old leftover data used to show as "Assessing companies".)
    const [st, latestRun] = await Promise.all([getScoringState(), getLatestRunningRun()]);
    const scoringActive = !!st?.active && !isScoringStale(st);
    const runningRun =
      latestRun && Date.now() - new Date(latestRun.started_at).getTime() < 2 * 60 * 60 * 1000 ? latestRun : null;

    let stage: 'idle' | 'fetching' | 'scoring';
    let detail = '';
    if (runningRun) {
      stage = 'fetching';
      detail = runningRun.jobs_found > 0 ? `${runningRun.jobs_found} found so far` : 'scraping…';
    } else if (scoringActive) {
      stage = 'scoring';
      detail = `${st?.done ?? 0}/${st?.total ?? 0} scored`;
    } else {
      stage = 'idle';
    }

    // Backlog summary — informative, shown only when idle, never styled as "running".
    const unassessed = Math.max(0, assessCandidates - assessed);
    const backlog: string[] = [];
    if (unscored > 0) backlog.push(`${unscored} to score`);
    if (unassessed > 0) backlog.push(`${unassessed} to assess`);
    if (queued > 0) backlog.push(`${queued} queued to tailor`);
    const pending = backlog.join(' · ');

    return NextResponse.json({
      enabled: !!settings.auto_pipeline_enabled,
      cutoff,
      stage,
      pending,
      detail,
      stages: [
        { key: 'fetched', label: 'Fetched', count: fetched },
        { key: 'skill_gate', label: 'No skill match', archived: archivedNoSkill, isCull: true },
        { key: 'scored', label: 'Scored', count: scored + archivedLowScore, sub: unscored > 0 ? `${unscored} pending` : '' },
        { key: 'score_cut', label: `Scored ≤ ${cutoff}`, archived: archivedLowScore, isCull: true },
        { key: 'survivors', label: 'Survivors', count: scored },
        { key: 'assessed', label: 'Companies assessed', count: assessed, sub: lowTier > 0 ? `${lowTier} low-tier excluded` : '' },
        { key: 'eligible', label: 'Eligible (good/med)', count: eligibleForTailor },
        { key: 'queued', label: 'Queued → Tailor', count: queued },
        { key: 'tailored', label: 'Tailored', count: tailored },
      ],
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
