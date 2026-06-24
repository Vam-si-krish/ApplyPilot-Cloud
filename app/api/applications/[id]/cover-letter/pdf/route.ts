/**
 * GET /api/applications/[id]/cover-letter/pdf — short-lived signed URL for the
 * application's cover-letter PDF in the private `resumes` bucket (ADR 0035). The
 * signed URL carries a recruiter-friendly download filename ("Name - Company - Cover
 * Letter.pdf") instead of the storage hash. Session-gated.
 */
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import type { ResumeDoc } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BUCKET = process.env.RESUMES_BUCKET || 'resumes';

function clean(s: string | null | undefined): string {
  return (s || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function coverFilename(name?: string | null, company?: string | null): string {
  const parts = [clean(name), clean(company), 'Cover Letter'].filter(Boolean);
  const base = parts.length > 1 ? parts.join(' - ') : 'cover-letter';
  return `${base}.pdf`;
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { data: app, error } = await supabaseAdmin()
    .from('applications')
    .select('cover_letter_pdf_path, tailored_resume, job:jobs(company)')
    .eq('id', params.id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const path = app?.cover_letter_pdf_path as string | null;
  if (!path) return NextResponse.json({ error: 'no cover letter generated yet' }, { status: 404 });

  const resume = app?.tailored_resume as ResumeDoc | null;
  const job = (Array.isArray(app?.job) ? app?.job[0] : app?.job) as { company?: string | null } | null;
  const filename = coverFilename(resume?.basics?.name, job?.company);

  const { data, error: signErr } = await supabaseAdmin()
    .storage.from(BUCKET)
    .createSignedUrl(path, 300, { download: filename });
  if (signErr || !data) return NextResponse.json({ error: signErr?.message || 'could not sign URL' }, { status: 500 });
  return NextResponse.json({ url: data.signedUrl, filename });
}
