/**
 * POST /api/applications/ats-check { id } — re-run the local ATS match with the
 * TAILORED résumé against the application's job (ADR 0053 addendum).
 *
 * The Jobscan-style loop: tailor → rescan → see whether the keyword/skill gaps
 * actually closed. Session-gated, pure CPU, no LLM — this is NOT the dropped
 * LLM re-scoring of tailored résumés (ADR 0050) and never touches fit_score.
 *
 * The base résumé is scored against the same job in the same call so the
 * before→after pair is computed identically (single-job mode drops the
 * batch-IDF keywords component on both sides). The job's stored prefilter_score
 * can therefore differ slightly from `base` here — that one includes keywords.
 */
import { NextResponse } from 'next/server';
import { getApplicationWithJob, getScoringResumeText, getSettings, updateApplication } from '@/lib/db';
import { resumeToText } from '@/lib/resume';
import { atsMatchScores } from '@/lib/prefilter';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(req: Request) {
  let id: string;
  try {
    const body = (await req.json()) as { id?: unknown };
    if (typeof body.id !== 'string' || !body.id) throw new Error('no id');
    id = body.id;
  } catch {
    return NextResponse.json({ error: 'invalid body — expected { id }' }, { status: 400 });
  }

  try {
    const app = await getApplicationWithJob(id);
    if (!app) return NextResponse.json({ error: 'application not found' }, { status: 404 });
    if (!app.tailored_resume) {
      return NextResponse.json({ error: 'No tailored résumé yet — generate one first.' }, { status: 409 });
    }
    if (!app.job) return NextResponse.json({ error: 'Job no longer exists.' }, { status: 409 });

    const skills = await getSettings().then((s) => s.skills ?? []).catch(() => [] as string[]);
    const job = { id: app.job.id, title: app.job.title ?? '', text: app.job.full_description ?? '' };

    const tailored = atsMatchScores({ text: resumeToText(app.tailored_resume), skills }, [job]).get(job.id);
    if (!tailored) return NextResponse.json({ error: 'Tailored résumé produced no text to match.' }, { status: 409 });

    const baseText = await getScoringResumeText().catch(() => '');
    const base = atsMatchScores({ text: baseText, skills }, [job]).get(job.id) ?? null;

    await updateApplication(id, {
      tailored_match_score: tailored.score,
      tailored_match_breakdown: tailored.breakdown,
    });

    return NextResponse.json({ ok: true, base, tailored });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[ats-check]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
