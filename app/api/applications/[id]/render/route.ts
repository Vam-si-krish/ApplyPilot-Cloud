/**
 * POST /api/applications/[id]/render — trigger the résumé worker to render the
 * application's tailored résumé into a one-page PDF (ADR 0024 Phase 3/4). This
 * route just proxies to the worker (Puppeteer can't run in a serverless function);
 * the worker reads Supabase, renders, uploads to the `resumes` bucket, and updates
 * the row (status + pdf_path). Session-gated.
 *
 * Managed forks use deployment-owned RESUME_WORKER_URL/RESUME_WORKER_SECRET. Legacy
 * single-owner deployments may use the Settings override through workerConfig.
 */
import { NextResponse } from 'next/server';
import { getSettings } from '@/lib/db';
import { workerRequestHeaders } from '@/lib/workerAuth';
import { resolveWorkerConfig } from '@/lib/workerConfig';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const settings = await getSettings().catch(() => null);
  const worker = resolveWorkerConfig(settings);
  if (!worker) {
    return NextResponse.json(
      { error: 'Résumé worker not configured — set RESUME_WORKER_URL and RESUME_WORKER_SECRET.' },
      { status: 503 },
    );
  }

  try {
    const r = await fetch(`${worker.url}/generate`, {
      method: 'POST',
      headers: workerRequestHeaders(worker.secret),
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
