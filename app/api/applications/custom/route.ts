/**
 * POST /api/applications/custom — add a manually-entered job and queue its application
 * (ADR 0034). For jobs the user finds themselves (e.g. from a recruiter email) so they
 * can tailor a résumé to it. Title + description are required; company and link are
 * optional. Session-gated. Returns the new application (joined with its job) so the UI
 * can drop it straight into the list.
 */
import { NextResponse } from 'next/server';
import { createCustomApplication } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  let body: { title?: unknown; company?: unknown; url?: unknown; description?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  if (!title) return NextResponse.json({ error: 'A job title is required.' }, { status: 400 });
  if (!description) return NextResponse.json({ error: 'A job description is required.' }, { status: 400 });

  try {
    const application = await createCustomApplication({
      title,
      company: typeof body.company === 'string' ? body.company : null,
      url: typeof body.url === 'string' ? body.url : null,
      description,
    });
    return NextResponse.json({ ok: true, application });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
