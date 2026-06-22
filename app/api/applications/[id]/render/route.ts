/**
 * POST /api/applications/[id]/render — trigger the résumé worker to render the
 * application's tailored résumé into a one-page PDF (ADR 0024 Phase 3/4). This
 * route just proxies to the worker (Puppeteer can't run in a serverless function);
 * the worker reads Supabase, renders, uploads to the `resumes` bucket, and updates
 * the row (status + pdf_path). Session-gated.
 *
 * Needs env: RESUME_WORKER_URL (e.g. the Cloudflare Tunnel URL, or http://localhost:8787
 * during local testing) and RESUME_WORKER_SECRET (matches the worker's WORKER_SECRET).
 */
import { NextResponse } from 'next/server';
import { getSettings } from '@/lib/db';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const settings = await getSettings().catch(() => null);
  // Prefer the local env var (dev → localhost, no tunnel needed); fall back to the
  // stored tunnel URL in production where the env var isn't set.
  const url = process.env.RESUME_WORKER_URL || settings?.resume_worker_url;
  const secret = process.env.RESUME_WORKER_SECRET;
  if (!url || !secret) {
    return NextResponse.json(
      { error: 'Résumé worker not configured — set RESUME_WORKER_URL and RESUME_WORKER_SECRET.' },
      { status: 503 },
    );
  }

  try {
    const r = await fetch(`${url.replace(/\/$/, '')}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
      body: JSON.stringify({ id: params.id }),
      // Worker render (auto-fit, several passes) can take a few seconds.
      signal: AbortSignal.timeout(55_000),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return NextResponse.json({ error: data.error || `worker error (${r.status})` }, { status: r.status });
    }
    return NextResponse.json({ ok: true, ...data });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const friendly = msg.includes('fetch') || msg.includes('timeout') || msg.includes('abort')
      ? 'Could not reach the résumé worker (is it running and reachable?).'
      : msg;
    return NextResponse.json({ error: friendly }, { status: 502 });
  }
}
