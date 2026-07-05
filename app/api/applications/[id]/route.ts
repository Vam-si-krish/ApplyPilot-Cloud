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
  let body: { status?: unknown; applied_at?: unknown; tailored_resume?: unknown; template?: unknown; tailor_instructions?: unknown; parked?: unknown };
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
  // "Set Aside" tab (ADR 0061): park/unpark an application out of the working Queue.
  if (typeof body.parked === 'boolean') patch.parked = body.parked;
  if ('tailor_instructions' in body) {
    patch.tailor_instructions =
      typeof body.tailor_instructions === 'string' ? body.tailor_instructions.slice(0, 2000) : null;
  }
  if ('tailored_resume' in body) {
    patch.tailored_resume = body.tailored_resume == null ? null : normalizeResume(body.tailored_resume);
  }

  if (Object.keys(patch).length === 1) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 });
  }

  // Unmarking an applied application also steps its status back so it doesn't
  // stay green: 'ready' when a tailored résumé exists, else 'queued'.
  if (patch.applied_at === null && !('status' in patch)) {
    const { data: row } = await supabaseAdmin()
      .from('applications')
      .select('status, tailored_resume')
      .eq('id', params.id)
      .maybeSingle();
    if (row?.status === 'applied') patch.status = row.tailored_resume ? 'ready' : 'queued';
  }

  const { data: updated, error } = await supabaseAdmin()
    .from('applications')
    .update(patch)
    .eq('id', params.id)
    .select('job_id')
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Keep the JOB row in agreement (the Jobs tab, stats, and the ADR-0057
  // apply-once-per-requisition guard all read jobs.applied_at).
  if ('applied_at' in patch && updated?.job_id) {
    await supabaseAdmin().from('jobs').update({ applied_at: patch.applied_at }).eq('id', updated.job_id);
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { error } = await supabaseAdmin().from('applications').delete().eq('id', params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
