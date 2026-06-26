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
 * The caller sends ids in small chunks; this scores all given ids in one pass, so
 * keep chunks bounded (a hard cap guards against a single oversized request).
 */
import { NextResponse } from 'next/server';
import { getJobsByIds, getScoringResumeText, getSettings } from '@/lib/db';
import { buildScoringClient, scoreJobRows } from '@/lib/scoreRunner';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_PER_CALL = 10; // keep one request comfortably under the serverless timeout

export async function POST(req: Request) {
  let body: { ids?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === 'string').slice(0, MAX_PER_CALL) : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: 'no ids provided' }, { status: 400 });
  }

  const rows = await getJobsByIds(ids);
  const settings = await getSettings();
  // Re-scoring already-scored jobs is gated behind a Settings toggle (ADR 0039) so a stray
  // click can't overwrite scores or burn LLM calls. OFF (default): score only jobs with no
  // AI score yet (a chosen 'filtered' job is re-evaluated). ON: re-score every picked job.
  const toScore = settings.allow_rescore
    ? rows
    : rows.filter((j) => j.status === 'unscored' || j.status === 'filtered');
  const skipped = rows.length - toScore.length;

  if (toScore.length === 0) {
    return NextResponse.json({ ok: true, scored: 0, filtered: 0, skipped });
  }

  const resume = await getScoringResumeText();
  const client = await buildScoringClient(settings);

  // prefilterThreshold: null → bypass the gate; the manual selection overrides it.
  const { scored, filtered, errors } = await scoreJobRows(toScore, { resume, client, prefilterThreshold: null });

  return NextResponse.json({ ok: true, scored, filtered, errors, skipped });
}
