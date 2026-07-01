/**
 * POST /api/jobs/clear-scores — bulk-clear a score/tailoring artifact for selected jobs.
 *
 * Session-gated (middleware). Gated a SECOND time by the `allow_delete_scores` setting: a
 * deliberate danger toggle in Settings must be ON, so a stray click can't wipe scores.
 * Body: { ids: string[], target: 'fit' | 'company' | 'match' | 'tailored' }.
 *
 * What each target clears:
 *  - 'fit'      → the AI fit score + its derived fields; resets status to 'unscored' so the
 *                 job re-enters the scoring queue and can be freshly scored.
 *  - 'company'  → the AI company assessment (tier + note).
 *  - 'match'    → the cheap keyword/skill match gate (skill_match_score, prefilter_score,
 *                 matched/unmatched_skills).
 *  - 'tailored' → the linked application's tailored résumé (résumé + changes + tailored score).
 */
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSettings } from '@/lib/db';

export const runtime = 'nodejs';

type Target = 'fit' | 'company' | 'match' | 'tailored';
const TARGETS: Target[] = ['fit', 'company', 'match', 'tailored'];

export async function POST(req: Request) {
  let body: { ids?: unknown; target?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === 'string') : [];
  const target = body.target as Target;
  if (ids.length === 0) return NextResponse.json({ error: 'no ids provided' }, { status: 400 });
  if (!TARGETS.includes(target)) {
    return NextResponse.json({ error: `target must be one of ${TARGETS.join(', ')}` }, { status: 400 });
  }

  // Danger gate: only proceed when the Settings toggle is explicitly on.
  const settings = await getSettings();
  if (!settings.allow_delete_scores) {
    return NextResponse.json(
      { error: 'Deleting scores is off. Enable "Allow deleting scores" in Settings first.' },
      { status: 409 },
    );
  }

  const db = supabaseAdmin();

  // 'tailored' lives on the applications table (one per job_id), not on jobs.
  if (target === 'tailored') {
    const { data, error } = await db
      .from('applications')
      .update({
        tailored_resume: null,
        tailor_changes: null,
        tailored_fit_score: null,
        tailored_score_note: null,
      })
      .in('job_id', ids)
      .select('id');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, cleared: data?.length ?? 0 });
  }

  // The remaining targets are columns on the jobs table.
  const patch: Record<string, unknown> =
    target === 'fit'
      ? {
          fit_score: null,
          score_note: null,
          score_keywords: null,
          score_reasoning: null,
          score_breakdown: null,
          employment_type: null,
          scored_at: null,
          status: 'unscored', // back into the scoring queue
        }
      : target === 'company'
        ? { company_tier: null, company_tier_note: null }
        : { skill_match_score: null, prefilter_score: null, matched_skills: null, unmatched_skills: null }; // 'match'

  const { data, error } = await db.from('jobs').update(patch).in('id', ids).select('id');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, cleared: data?.length ?? 0 });
}
