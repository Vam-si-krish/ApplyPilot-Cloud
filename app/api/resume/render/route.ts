/**
 * POST /api/resume/render — render a (possibly hand-edited) résumé JSON to a PDF and
 * stream it back as a download (ADR 0024, manual flow). Proxies to the worker's
 * /render-inline (Puppeteer can't run serverless). Session-gated.
 *
 * Body: { resume: ResumeDoc, template?: string, filename?: string }
 */
import { NextResponse } from 'next/server';
import { getSettings } from '@/lib/db';
import { normalizeResume } from '@/lib/resume';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request) {
  let body: { resume?: unknown; template?: unknown; filename?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  if (!body.resume || typeof body.resume !== 'object') {
    return NextResponse.json({ error: 'resume required' }, { status: 400 });
  }
  const resume = normalizeResume(body.resume);
  const template = typeof body.template === 'string' ? body.template : 'classic';
  const filename = (typeof body.filename === 'string' && body.filename) || 'resume.pdf';

  const settings = await getSettings().catch(() => null);
  // The UI-configured value wins (so editing it in Settings takes effect without a
  // redeploy); the env var is the fallback/bootstrap default.
  const url = settings?.resume_worker_url?.trim() || process.env.RESUME_WORKER_URL;
  const secret = settings?.resume_worker_secret?.trim() || process.env.RESUME_WORKER_SECRET;
  if (!url || !secret) {
    return NextResponse.json(
      { error: 'Résumé worker not configured — set RESUME_WORKER_URL and RESUME_WORKER_SECRET.' },
      { status: 503 },
    );
  }

  try {
    const r = await fetch(`${url.replace(/\/$/, '')}/render-inline`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
      body: JSON.stringify({ resume, template }),
      signal: AbortSignal.timeout(55_000),
    });
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      return NextResponse.json({ error: data.error || `worker error (${r.status})` }, { status: r.status });
    }
    const pdf = await r.arrayBuffer();
    return new NextResponse(pdf, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename.replace(/[^\w.\- ]/g, '_')}"`,
        'X-Resume-Pages': r.headers.get('X-Resume-Pages') || '',
        'X-Resume-Too-Long': r.headers.get('X-Resume-Too-Long') || '',
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const friendly = msg.includes('fetch') || msg.includes('timeout') || msg.includes('abort')
      ? 'Could not reach the résumé worker (is it running and reachable?).'
      : msg;
    return NextResponse.json({ error: friendly }, { status: 502 });
  }
}
