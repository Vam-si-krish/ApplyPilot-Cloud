/**
 * GET /api/applications/[id]/pdf — return a short-lived signed URL for the
 * application's generated PDF in the private `resumes` bucket (ADR 0024). The signed
 * URL carries a proper download filename (ADR 0030) — "Name - Company - Resume.pdf",
 * the recruiter-friendly convention — instead of the storage hash. Session-gated.
 */
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import type { ResumeDoc } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BUCKET = process.env.RESUMES_BUCKET || 'resumes';

/** Strip characters that are illegal/awkward in filenames; collapse whitespace. */
function clean(s: string | null | undefined): string {
  return (s || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** "Name - Company - Resume.pdf" (best-practice résumé filename), dropping empty parts. */
function resumeFilename(name?: string | null, company?: string | null): string {
  const parts = [clean(name), clean(company), 'Resume'].filter(Boolean);
  const base = parts.length > 1 ? parts.join(' - ') : 'resume';
  return `${base}.pdf`;
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { data: app, error } = await supabaseAdmin()
    .from('applications')
    .select('pdf_path, tailored_resume, job:jobs(company)')
    .eq('id', params.id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const path = app?.pdf_path as string | null;
  if (!path) return NextResponse.json({ error: 'no PDF generated yet' }, { status: 404 });

  const resume = app?.tailored_resume as ResumeDoc | null;
  const job = (Array.isArray(app?.job) ? app?.job[0] : app?.job) as { company?: string | null } | null;
  const filename = resumeFilename(resume?.basics?.name, job?.company);

  const { data, error: signErr } = await supabaseAdmin()
    .storage.from(BUCKET)
    .createSignedUrl(path, 300, { download: filename });
  if (signErr || !data) return NextResponse.json({ error: signErr?.message || 'could not sign URL' }, { status: 500 });
  return NextResponse.json({ url: data.signedUrl, filename });
}
