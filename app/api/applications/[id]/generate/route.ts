/**
 * POST /api/applications/[id]/generate — produce a job-tailored résumé for one
 * application (ADR 0024, Phase 2). One LLM call (serverless-safe) that reframes the
 * base résumé toward the job using the scoring-v2 signals we already store; the
 * result is merged onto the base so it can only contain truthful, real content.
 *
 * Writes tailored_resume + status 'ready' on success, or status 'failed' + error
 * on any failure — never persists a fabricated résumé. (PDF rendering happens later
 * in the MacBook worker; this route produces the structured content.)
 */
import { NextResponse } from 'next/server';
import { getApplicationWithJob, getBaseResume, getSettings, updateApplication } from '@/lib/db';
import { buildScoringClient } from '@/lib/scoreRunner';
import { tailorResume, TailorSignals } from '@/lib/resumeTailor';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const id = params.id;
  try {
    const app = await getApplicationWithJob(id);
    if (!app) return NextResponse.json({ error: 'application not found' }, { status: 404 });
    if (!app.job) return NextResponse.json({ error: 'the job for this application was removed' }, { status: 409 });

    const base = await getBaseResume();
    if (!base || base.work.length === 0) {
      return NextResponse.json(
        { error: 'No base résumé yet — build it under Applications → Base résumé first.' },
        { status: 409 },
      );
    }

    await updateApplication(id, { status: 'generating', error: null });

    const job = app.job;
    const signals: TailorSignals = {
      missing: job.score_breakdown?.missing ?? null,
      matched: job.matched_skills ?? null,
      unmatched: job.unmatched_skills ?? null,
      keywords: job.score_keywords ?? null,
    };

    const settings = await getSettings();
    const client = await buildScoringClient(settings);

    try {
      const tailored = await tailorResume(base, job, signals, client);
      await updateApplication(id, { tailored_resume: tailored, status: 'ready', error: null });
      return NextResponse.json({ ok: true, status: 'ready', tailored_resume: tailored });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await updateApplication(id, { status: 'failed', error: msg });
      return NextResponse.json({ error: msg, status: 'failed' }, { status: 500 });
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
