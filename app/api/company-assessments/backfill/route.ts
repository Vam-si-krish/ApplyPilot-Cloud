/**
 * POST /api/company-assessments/backfill — assess companies of EXISTING jobs
 * (rows scored before ADR 0101, or whose assessment batch previously failed).
 *
 * One invocation: stamp anything already assessable, assess up to
 * COMPANIES_PER_INVOCATION not-yet-assessed companies via the scoring-lane LLM,
 * stamp their jobs, and report what's left. The Jobs-page button loops this
 * until done — same chunked self-limiting pattern as /api/score-batch, bounded
 * to stay inside the serverless window. Session-gated by middleware; runs under
 * the caller's user scope, so it only ever stamps the caller's own job rows.
 */
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSettings } from '@/lib/db';
import { buildScoringClient } from '@/lib/scoreRunner';
import {
  assessCompanies,
  collectCandidates,
  insertCompanyAssessments,
  stampJobsFromAssessments,
} from '@/lib/companyAssessment';
import type { Job } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** ≤2 LLM batches per invocation keeps a slow provider inside maxDuration. */
const COMPANIES_PER_INVOCATION = 30;

async function countRemaining(): Promise<number> {
  const { count, error } = await supabaseAdmin()
    .from('jobs')
    .select('id', { count: 'exact', head: true })
    .not('company_key', 'is', null)
    .is('apply_channel', null);
  if (error) throw new Error(`count unassessed jobs: ${error.message}`);
  return count ?? 0;
}

export async function POST() {
  try {
    // 1. Stamp rows whose company is already in the shared cache (covers rows
    //    inserted or imported while their company's verdict already existed).
    let stamped = await stampJobsFromAssessments(null);

    // 2. Any row still unstamped has a company with no assessment. Pull a window
    //    and collapse it to distinct companies.
    const { data, error } = await supabaseAdmin()
      .from('jobs')
      .select('company, company_size, title, full_description')
      .not('company_key', 'is', null)
      .is('apply_channel', null)
      .order('discovered_at', { ascending: false })
      .limit(500);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const candidates = collectCandidates((data ?? []) as Job[]).slice(0, COMPANIES_PER_INVOCATION);
    if (candidates.length === 0) {
      return NextResponse.json({ ok: true, companies_assessed: 0, jobs_stamped: stamped, remaining_jobs: 0, done: true });
    }

    let client;
    try {
      client = await buildScoringClient(await getSettings());
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 409 });
    }

    const verdicts = await assessCompanies(candidates, client);
    if (verdicts.length > 0) {
      await insertCompanyAssessments(verdicts, client);
      stamped += await stampJobsFromAssessments(verdicts.map((v) => v.company_key));
    }

    const remaining = await countRemaining();
    return NextResponse.json({
      ok: true,
      companies_assessed: verdicts.length,
      jobs_stamped: stamped,
      remaining_jobs: remaining,
      done: remaining === 0,
      // Nothing parsed out of a non-empty batch — the caller must stop looping
      // instead of re-burning the same call forever.
      ...(verdicts.length === 0 ? { stalled: true } : {}),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
