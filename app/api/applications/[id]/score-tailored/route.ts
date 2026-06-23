/**
 * POST /api/applications/[id]/score-tailored — fit-score the application's TAILORED
 * résumé against its job (ADR 0029), so the Applications view can show the lift over
 * the original job fit_score. Session-gated. ONE fast LLM call (the scorer), well
 * under the serverless timeout — same scoring rubric as the rest of the app.
 */
import { NextResponse } from 'next/server';
import { getApplicationWithJob, getSettings, updateApplication } from '@/lib/db';
import { buildScoringClient } from '@/lib/scoreRunner';
import { scoreJob } from '@/lib/scoring';
import { resumeToText } from '@/lib/resume';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const id = params.id;
  try {
    const app = await getApplicationWithJob(id);
    if (!app) return NextResponse.json({ error: 'application not found' }, { status: 404 });
    if (!app.job) return NextResponse.json({ error: 'the job for this application was removed' }, { status: 409 });
    if (!app.tailored_resume) {
      return NextResponse.json({ error: 'No tailored résumé yet — generate it first.' }, { status: 409 });
    }

    const settings = await getSettings();
    const client = await buildScoringClient(settings);
    const text = resumeToText(app.tailored_resume);

    const result = await scoreJob(
      text,
      { title: app.job.title, company: app.job.company, location: app.job.location, full_description: app.job.full_description },
      client,
    );

    await updateApplication(id, { tailored_fit_score: result.score, tailored_score_note: result.note });
    return NextResponse.json({ ok: true, tailored_fit_score: result.score, note: result.note });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
