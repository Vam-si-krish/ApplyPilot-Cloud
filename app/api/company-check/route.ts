/**
 * POST /api/company-check — AI company assessment for a hand-picked set of jobs
 * (ADR 0009). Session-gated; runs only on the ids the user selects (never the
 * whole batch). One LLM call per job via assessCompany; stores company_tier /
 * company_tier_note. Separate from fit-scoring (frozen SCORE_PROMPT untouched).
 *
 * Caller chunks the ids; a hard cap guards against one oversized request.
 */
import { NextResponse } from 'next/server';
import { getJobsByIds, getSettings } from '@/lib/db';
import { buildScoringClient } from '@/lib/scoreRunner';
import { assessCompany } from '@/lib/companyCheck';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_PER_CALL = 10;

export async function POST(req: Request) {
  let body: { ids?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const ids = Array.isArray(body.ids)
    ? body.ids.filter((x): x is string => typeof x === 'string').slice(0, MAX_PER_CALL)
    : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: 'no ids provided' }, { status: 400 });
  }

  const rows = await getJobsByIds(ids);
  if (rows.length === 0) {
    return NextResponse.json({ ok: true, assessed: 0 });
  }

  const settings = await getSettings();
  const client = await buildScoringClient(settings);

  let assessed = 0;
  for (const job of rows) {
    const { tier, note } = await assessCompany(job, client);
    const { error } = await supabaseAdmin()
      .from('jobs')
      .update({ company_tier: tier, company_tier_note: note })
      .eq('id', job.id);
    if (!error) assessed++;
  }

  return NextResponse.json({ ok: true, assessed });
}
