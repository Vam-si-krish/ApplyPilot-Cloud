/** PATCH /api/jobs/[id] — toggle shortlist or change status (e.g. archive). */
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  let body: { is_shortlisted?: boolean; status?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (typeof body.is_shortlisted === 'boolean') patch.is_shortlisted = body.is_shortlisted;
  if (body.status && ['unscored', 'scored', 'archived'].includes(body.status)) patch.status = body.status;
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 });
  }

  const { error } = await supabaseAdmin().from('jobs').update(patch).eq('id', params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
