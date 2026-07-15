/**
 * POST /api/resume/tailor — manual résumé tailoring (ADR 0024). Given a pasted job
 * description (+ optional title/company), reframe the base résumé toward it and
 * return the tailored ResumeDoc. No job row / application needed — this is the
 * standalone "paste a JD → get a résumé" flow. Session-gated. One LLM call;
 * truthful (same merge discipline as the scored path).
 */
import { NextResponse } from 'next/server';
import { getBaseResume, getCandidatePreferences, getSettings } from '@/lib/db';
import { buildTailoringClient } from '@/lib/scoreRunner';
import { tailorResume } from '@/lib/resumeTailor';
import { atsMatchScores } from '@/lib/prefilter';
import { resumeToText } from '@/lib/resume';
import { globalTailoringInstructions, resolveTailoringPolicy } from '@/lib/candidatePreferences';

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
        { error: 'No base résumé yet — build it under Candidate Profile → Résumé first.' },
        { status: 409 },
      );
    }
    const [settings, preferences] = await Promise.all([getSettings(), getCandidatePreferences()]);
    const client = await buildTailoringClient(settings);
    const title = typeof body.title === 'string' ? body.title : null;
    // No job row in the manual flow, but the local ATS scan (ADR 0053) still works on the
    // pasted JD: exact posting-form terms the base résumé lacks, mirrored verbatim by the prompt.
    const ats = atsMatchScores({ text: resumeToText(base), skills: settings.skills ?? [] }, [
      { id: 'manual', title: title ?? '', text: jd },
    ]).get('manual');
    const { resume, changes } = await tailorResume(
      base,
      {
        title,
        company: typeof body.company === 'string' ? body.company : null,
        full_description: jd,
      },
      { atsMissing: ats?.breakdown.missing ?? null }, // no scorer signals in the manual flow
      client,
      globalTailoringInstructions(preferences),
      resolveTailoringPolicy(preferences),
    );
    return NextResponse.json({ ok: true, resume, changes });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
