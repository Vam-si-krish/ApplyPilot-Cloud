/**
 * GET/PUT /api/base-resume — the editable structured base résumé (ADR 0024),
 * stored on profile.base_resume. Session-gated. PUT normalizes the incoming JSON
 * to a well-formed ResumeDoc before saving (defensive boundary).
 */
import { NextResponse } from 'next/server';
import { getBaseResume, saveBaseResume } from '@/lib/db';
import { normalizeResume } from '@/lib/resume';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json({ base_resume: await getBaseResume() });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  // Accept either the bare resume doc or { base_resume: doc }.
  const raw = body && typeof body === 'object' && 'base_resume' in (body as Record<string, unknown>)
    ? (body as Record<string, unknown>).base_resume
    : body;
  const doc = normalizeResume(raw);
  try {
    await saveBaseResume(doc);
    return NextResponse.json({ ok: true, base_resume: doc });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
