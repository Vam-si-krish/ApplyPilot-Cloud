/**
 * POST /api/resume/tailor — manual résumé tailoring (ADR 0024). Given a pasted job
 * description (+ optional title/company), reframe the base résumé toward it and
 * return the tailored ResumeDoc. No job row / application needed — this is the
 * standalone "paste a JD → get a résumé" flow. Session-gated. One LLM call;
 * truthful (same merge discipline as the scored path).
 */
import { NextResponse } from 'next/server';
import { getBaseResume, getSettings } from '@/lib/db';
import { buildTailoringClient } from '@/lib/scoreRunner';
import { tailorResume } from '@/lib/resumeTailor';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request) {
  let body: { jobDescription?: unknown; title?: unknown; company?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const jd = typeof body.jobDescription === 'string' ? body.jobDescription.trim() : '';
  if (!jd) return NextResponse.json({ error: 'Paste a job description first.' }, { status: 400 });

  try {
    const base = await getBaseResume();
    if (!base || base.work.length === 0) {
      return NextResponse.json(
        { error: 'No base résumé yet — build it under Applications → Base résumé first.' },
        { status: 409 },
      );
    }
    const settings = await getSettings();
    const client = await buildTailoringClient(settings);
    const { resume, changes } = await tailorResume(
      base,
      {
        title: typeof body.title === 'string' ? body.title : null,
        company: typeof body.company === 'string' ? body.company : null,
        full_description: jd,
      },
      {}, // no scoring signals in the manual flow
      client,
    );
    return NextResponse.json({ ok: true, resume, changes });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
