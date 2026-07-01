/**
 * POST /api/company-check — AI company assessment for a hand-picked set of jobs
 * (ADR 0009). Session-gated; runs only on the ids the user selects (never the
 * whole batch). One LLM call per job via assessCompany; stores company_tier /
 * company_tier_note. Separate from fit-scoring (frozen SCORE_PROMPT untouched).
 *
 * Subscription provider (ADR 0042): each assessment is an Agent-SDK subprocess call on
 * the worker. Running N of them inside this ~60s serverless function risks a timeout, so
 * — exactly like /api/score-selected — the batch is delegated to the worker's POST
 * /assess-jobs, which assesses in the background and writes to Supabase. The response is
 * `delegated:true`; the client polls /api/score-progress (mode=assess) for real progress.
 *
 * API-key providers stay synchronous (fast enough under the ceiling). Caller chunks the ids.
 */
import { NextResponse } from 'next/server';
import { getJobsByIds, getSettings } from '@/lib/db';
import { supabaseAdmin } from '@/lib/supabase';
import { buildScoringClient } from '@/lib/scoreRunner';
import { assessCompanyRows } from '@/lib/companyCheck';
import { SUBSCRIPTION_PROVIDER } from '@/lib/llm';

export const runtime = 'nodejs';
export const maxDuration = 60;

const tag = '[company-check]';
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

  const settings = await getSettings();
  const provider = (settings.score_provider || settings.llm_provider || '').trim().toLowerCase();

  // Subscription mode: delegate to the worker's /assess-jobs (background), like scoring.
  if (provider === SUBSCRIPTION_PROVIDER) {
    const workerUrl = (settings.resume_worker_url?.trim() || process.env.RESUME_WORKER_URL || '').replace(/\/$/, '');
    const workerSecret = settings.resume_worker_secret?.trim() || process.env.RESUME_WORKER_SECRET || '';
    if (!workerUrl || !workerSecret) {
      console.error(tag, 'subscription mode but worker not configured');
      return NextResponse.json(
        { error: 'Subscription company assessment requires the worker URL and secret to be set in Settings.' },
        { status: 409 },
      );
    }

    // Reset the tier to a clean "pending" (null) for the selected jobs BEFORE handing off,
    // so the client's poll can tell a fresh assessment apart from a stale one: the worker
    // re-writes company_tier, and /api/score-progress (mode=assess) counts null→set as done.
    // Without this, re-assessing already-rated jobs would look "done" instantly. Best-effort.
    await supabaseAdmin()
      .from('jobs')
      .update({ company_tier: null, company_tier_note: null })
      .in('id', ids)
      .then(undefined, () => {});

    let resp: Response;
    try {
      resp = await fetch(`${workerUrl}/assess-jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${workerSecret}` },
        body: JSON.stringify({ ids }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(tag, 'worker /assess-jobs fetch failed:', msg);
      return NextResponse.json({ error: `Could not reach worker: ${msg}` }, { status: 502 });
    }
    if (!resp.ok) {
      const d = (await resp.json().catch(() => ({}))) as { error?: string };
      const msg = d.error || `worker responded ${resp.status}`;
      console.error(tag, 'worker /assess-jobs error:', msg);
      return NextResponse.json({ error: msg }, { status: resp.status });
    }
    const d = (await resp.json()) as { queued?: number };
    console.log(tag, 'delegated ok queued=', d.queued);
    // delegated:true → the client polls /api/score-progress (mode=assess); scores land async.
    return NextResponse.json({ ok: true, delegated: true, queued: d.queued ?? ids.length, assessed: 0, errors: 0 });
  }

  // API-key path: assess synchronously (fast enough to stay under the function limit).
  const rows = await getJobsByIds(ids);
  if (rows.length === 0) {
    return NextResponse.json({ ok: true, assessed: 0 });
  }

  const client = await buildScoringClient(settings);
  const { assessed, errors } = await assessCompanyRows(rows, client);

  // Surface errors so a failing AI backend (e.g. the subscription worker down) shows up
  // as failures instead of silently writing 'unknown' and looking like it "skipped".
  return NextResponse.json({ ok: true, assessed, errors });
}
