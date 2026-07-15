/** PATCH /api/jobs/[id] — toggle shortlist, change status, or record applied_at. */
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  let body: { is_shortlisted?: boolean; status?: string; applied_at?: string | null; clicked_at?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (typeof body.is_shortlisted === 'boolean') patch.is_shortlisted = body.is_shortlisted;
  // The database invariant rejects `scored` unless fit_score is already numeric. The
  // browser only uses it to restore an archived job that retained its existing score.
  if (body.status && ['unscored', 'scored', 'archived', 'filtered'].includes(body.status)) patch.status = body.status;
  // applied_at: ISO string to mark applied, null to unmark
  if ('applied_at' in body) {
    patch.applied_at = body.applied_at === null ? null : (typeof body.applied_at === 'string' ? body.applied_at : null);
  }
  // clicked_at: ISO string when the user opens the apply link, null to clear
  if ('clicked_at' in body) {
    patch.clicked_at = body.clicked_at === null ? null : (typeof body.clicked_at === 'string' ? body.clicked_at : null);
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 });
  }

  const { error } = await supabaseAdmin().from('jobs').update(patch).eq('id', params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Keep any Tailor & Apply row in agreement (both tabs show applied state; only
  // jobs.applied_at feeds stats and the ADR-0057 apply-once guard, so they must match).
  if ('applied_at' in patch) {
    const { data: apps } = await supabaseAdmin()
      .from('applications')
      .select('id, status, tailored_resume')
      .eq('job_id', params.id);
    for (const app of apps ?? []) {
      const sync: Record<string, unknown> = { applied_at: patch.applied_at, updated_at: new Date().toISOString() };
      if (patch.applied_at) sync.status = 'applied';
      else if (app.status === 'applied') sync.status = app.tailored_resume ? 'ready' : 'queued';
      await supabaseAdmin().from('applications').update(sync).eq('id', app.id);
    }
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const { error } = await supabaseAdmin().from('jobs').delete().eq('id', params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
