/** PATCH /api/jobs/[id] — toggle shortlist, change status, or record applied_at. */
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  let body: { is_shortlisted?: boolean; status?: string; applied_at?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (typeof body.is_shortlisted === 'boolean') patch.is_shortlisted = body.is_shortlisted;
  if (body.status && ['unscored', 'scored', 'archived'].includes(body.status)) patch.status = body.status;
  // applied_at: ISO string to mark applied, null to unmark
  if ('applied_at' in body) {
    patch.applied_at = body.applied_at === null ? null : (typeof body.applied_at === 'string' ? body.applied_at : null);
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 });
  }

  const { error } = await supabaseAdmin().from('jobs').update(patch).eq('id', params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const { error } = await supabaseAdmin().from('jobs').delete().eq('id', params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
