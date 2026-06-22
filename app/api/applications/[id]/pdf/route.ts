/**
 * GET /api/applications/[id]/pdf — return a short-lived signed URL for the
 * application's generated PDF in the private `resumes` bucket (ADR 0024). The UI
 * uses it to preview/download. Session-gated.
 */
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BUCKET = process.env.RESUMES_BUCKET || 'resumes';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { data: app, error } = await supabaseAdmin()
    .from('applications')
    .select('pdf_path')
    .eq('id', params.id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const path = app?.pdf_path as string | null;
  if (!path) return NextResponse.json({ error: 'no PDF generated yet' }, { status: 404 });

  const { data, error: signErr } = await supabaseAdmin().storage.from(BUCKET).createSignedUrl(path, 300);
  if (signErr || !data) return NextResponse.json({ error: signErr?.message || 'could not sign URL' }, { status: 500 });
  return NextResponse.json({ url: data.signedUrl });
}
