/**
 * POST /api/score-selected — AI-score a specific set of jobs the user picked.
 *
 * Session-gated (not in middleware's PUBLIC/SELF_AUTH paths). The explicit
 * selection IS the user's filter, so the pre-filter gate is bypassed here — a
 * chosen job is scored directly even if its match % is below the auto threshold.
 * By default only jobs not yet AI-scored ('unscored' or previously 'filtered') are
 * scored; already-'scored'/'archived' ones are reported as skipped. The `allow_rescore`
 * setting (ADR 0039) unlocks RE-scoring already-scored jobs — a deliberate, gated path
 * so a stray click can't overwrite scores or burn LLM calls.
 *
 * Subscription provider (ADR 0042): each /llm call spawns an Agent SDK subprocess on
 * the worker. Calling N of them from Netlify times out the function. Instead the
 * whole batch is delegated to the worker's POST /score-jobs which scores in the
 * background and writes results directly to Supabase; this route responds immediately.
 */
import { NextResponse } from 'next/server';
import { getJobsByIds, getScoringResumeText, getSettings } from '@/lib/db';
import { buildScoringClient, scoreJobRows } from '@/lib/scoreRunner';
import { SUBSCRIPTION_PROVIDER } from '@/lib/llm';

export const runtime = 'nodejs';
export const maxDuration = 60;

const tag = '[score-selected]';
const MAX_PER_CALL = 10;

export async function POST(req: Request) {
  let body: { ids?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  try {
    const settings = await getSettings();
    const provider = (settings.score_provider || settings.llm_provider || '').trim().toLowerCase();
    const workerUrl = (settings.resume_worker_url?.trim() || process.env.RESUME_WORKER_URL || '').replace(/\/$/, '');
    const workerSecret = settings.resume_worker_secret?.trim() || process.env.RESUME_WORKER_SECRET || '';

    console.log(tag, 'start', JSON.stringify({ provider, workerUrl: workerUrl.slice(0, 40), hasSecret: !!workerSecret }));

    const rawIds = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === 'string') : [];
    const ids = rawIds.slice(0, MAX_PER_CALL);
    console.log(tag, `ids=${ids.length}`);

    if (ids.length === 0) {
      return NextResponse.json({ error: 'no ids provided' }, { status: 400 });
    }

    // Subscription mode: delegate to the worker's /score-jobs which runs scoring
    // fully in the background. Responds 200 immediately; scores appear on next refresh.
    if (provider === SUBSCRIPTION_PROVIDER) {
      if (!workerUrl || !workerSecret) {
        console.error(tag, 'subscription mode but worker not configured');
        return NextResponse.json(
          { error: 'Claude subscription scoring requires the worker URL and secret to be set in Settings.' },
          { status: 409 },
        );
      }

      console.log(tag, 'delegating to worker /score-jobs');
      let resp: Response;
      try {
        resp = await fetch(`${workerUrl}/score-jobs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${workerSecret}` },
          body: JSON.stringify({ ids }),
          signal: AbortSignal.timeout(15_000),
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(tag, 'worker /score-jobs fetch failed:', msg);
        return NextResponse.json({ error: `Could not reach worker: ${msg}` }, { status: 502 });
      }

      if (!resp.ok) {
        const d = (await resp.json().catch(() => ({}))) as { error?: string };
        const msg = d.error || `worker responded ${resp.status}`;
        console.error(tag, 'worker /score-jobs error:', msg);
        return NextResponse.json({ error: msg }, { status: resp.status });
      }

      const d = (await resp.json()) as { queued?: number };
      console.log(tag, 'delegated ok queued=', d.queued);
      // Return scored=queued so the UI toast shows the right count; actual scores
      // appear on the next job list refresh (worker writes directly to Supabase).
      return NextResponse.json({ ok: true, scored: d.queued ?? ids.length, filtered: 0, errors: 0, skipped: 0 });
    }

    // API-key path: score synchronously (fast enough to stay under the function limit).
    const rows = await getJobsByIds(ids);
    console.log(tag, `rows=${rows.length}`);

    const toScore = settings.allow_rescore
      ? rows
      : rows.filter((j) => j.status === 'unscored' || j.status === 'filtered');
    const skipped = rows.length - toScore.length;
    console.log(tag, `toScore=${toScore.length} skipped=${skipped}`);

    if (toScore.length === 0) {
      return NextResponse.json({ ok: true, scored: 0, filtered: 0, skipped });
    }

    const resume = await getScoringResumeText();
    console.log(tag, `resume=${resume.length}chars`);

    const client = await buildScoringClient(settings);
    console.log(tag, 'client built, scoring...');

    const { scored, filtered, errors } = await scoreJobRows(toScore, { resume, client, prefilterThreshold: null });
    console.log(tag, 'done', JSON.stringify({ scored, filtered, errors, skipped }));

    return NextResponse.json({ ok: true, scored, filtered, errors, skipped });
  } catch (e) {
    console.error(tag, 'unhandled error:', e instanceof Error ? e.stack : String(e));
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
