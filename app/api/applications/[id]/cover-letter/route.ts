/**
 * POST /api/applications/[id]/cover-letter — kick off cover-letter generation for one
 * application (ADR 0035). Like /generate, the LLM draft + PDF render can exceed
 * Netlify's ~26s ceiling, so this just proxies to the résumé worker (same Cloudflare
 * Tunnel) which acks 202 and finishes in the background; the UI polls the row for
 * cover_letter_pdf_path / cover_letter_error. Session-gated.
 */
import { NextResponse } from 'next/server';
import { getSettings } from '@/lib/db';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const id = params.id;
  const settings = await getSettings().catch(() => null);
  const url = settings?.resume_worker_url?.trim() || process.env.RESUME_WORKER_URL;
  const secret = settings?.resume_worker_secret?.trim() || process.env.RESUME_WORKER_SECRET;
  if (!url || !secret) {
    return NextResponse.json(
      { error: 'Résumé worker not configured — set RESUME_WORKER_URL and RESUME_WORKER_SECRET.' },
      { status: 503 },
    );
  }

  try {
    const r = await fetch(`${url.replace(/\/$/, '')}/cover-letter`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
      body: JSON.stringify({ id }),
      // The worker acks (202) before the LLM call runs, so this returns in ~1s.
      signal: AbortSignal.timeout(20_000),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return NextResponse.json({ error: data.error || `worker error (${r.status})` }, { status: r.status });
    }
    return NextResponse.json({ ok: true }, { status: 202 });
  } catch (e) {
    const msg =
      e instanceof Error && e.name === 'TimeoutError'
        ? 'The résumé worker did not respond — is it running?'
        : e instanceof Error
          ? e.message
          : String(e);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
