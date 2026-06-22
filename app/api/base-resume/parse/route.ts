/**
 * POST /api/base-resume/parse — one-time (re)build of the structured base résumé
 * from the user's plain-text résumé (profile.resume_text) via a single LLM call
 * (ADR 0024). Session-gated. Uses the active provider key (same path as scoring).
 * Persists profile.base_resume and returns it. On any failure, returns the error
 * — never a fabricated résumé.
 */
import { NextResponse } from 'next/server';
import { getResumeText, getSettings, saveBaseResume } from '@/lib/db';
import { buildScoringClient } from '@/lib/scoreRunner';
import { parseResumeText } from '@/lib/resumeParse';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST() {
  try {
    const resumeText = await getResumeText();
    const settings = await getSettings();
    const client = await buildScoringClient(settings);
    const doc = await parseResumeText(resumeText, client);
    await saveBaseResume(doc);
    return NextResponse.json({ ok: true, base_resume: doc });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
