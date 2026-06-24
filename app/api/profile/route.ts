/** GET/PUT /api/profile — the single-row user profile (id=1). */
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getProfile } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED = [
  'personal',
  'experience',
  'compensation',
  'work_authorization',
  'skills_boundary',
  // 'resume_text' retired (ADR 0036) — the structured base résumé is the single source.
  'resume_pdf_path',
] as const;

export async function GET() {
  try {
    return NextResponse.json(await getProfile());
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const key of ALLOWED) {
    if (key in body) patch[key] = body[key];
  }

  const { error } = await supabaseAdmin().from('profile').update(patch).eq('id', 1);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
