/**
 * PATCH  /api/applications/[id] — update status / mark applied / edited résumé / template.
 * DELETE /api/applications/[id] — remove the application. Session-gated (ADR 0024).
 */
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { normalizeResume } from '@/lib/resume';
import type { ApplicationStatus } from '@/lib/types';

export const runtime = 'nodejs';

const STATUSES: ApplicationStatus[] = ['queued', 'generating', 'ready', 'applied', 'failed'];

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  let body: { status?: unknown; applied_at?: unknown; tailored_resume?: unknown; template?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.status === 'string' && STATUSES.includes(body.status as ApplicationStatus)) {
    patch.status = body.status;
    // Stamp applied_at automatically when moving to 'applied' (unless caller set it).
    if (body.status === 'applied' && !('applied_at' in body)) patch.applied_at = new Date().toISOString();
  }
  if ('applied_at' in body) {
    patch.applied_at = body.applied_at === null ? null : typeof body.applied_at === 'string' ? body.applied_at : null;
  }
  if (typeof body.template === 'string') patch.template = body.template;
  if ('tailored_resume' in body) {
    patch.tailored_resume = body.tailored_resume == null ? null : normalizeResume(body.tailored_resume);
  }

  if (Object.keys(patch).length === 1) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 });
  }

  const { error } = await supabaseAdmin().from('applications').update(patch).eq('id', params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { error } = await supabaseAdmin().from('applications').delete().eq('id', params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
