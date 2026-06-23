/**
 * POST /api/applications/[id]/generate — kick off a job-tailored résumé for one
 * application (ADR 0024 Phase 2; moved to the worker per ADR 0027). The tailoring
 * is ONE LLM call that can take 30–90s — over Netlify's ~26s function ceiling — so
 * this route just proxies to the résumé worker (same Cloudflare Tunnel as /render)
 * and returns immediately. The worker marks the row 'generating', runs the call,
 * then writes tailored_resume + status 'ready'/'failed'; the UI polls for the result.
 *
 * Session-gated. Never persists a fabricated résumé (the worker merges onto the base).
 */
import { NextResponse } from 'next/server';
import { getSettings } from '@/lib/db';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const id = params.id;
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
    const r = await fetch(`${url.replace(/\/$/, '')}/tailor`, {
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
    // 202 from the worker: generation started; the client polls the row for the result.
    return NextResponse.json({ ok: true, status: data.status || 'generating' }, { status: 202 });
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
