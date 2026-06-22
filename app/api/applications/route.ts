/**
 * GET  /api/applications        — list applications joined with their job.
 * POST /api/applications {ids}   — queue an application per job (idempotent).
 * Session-gated (ADR 0024).
 */
import { NextResponse } from 'next/server';
import { addApplications, listApplications } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json({ applications: await listApplications() });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  let body: { ids?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === 'string') : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: 'no ids provided' }, { status: 400 });
  }
  try {
    const added = await addApplications(ids);
    return NextResponse.json({ ok: true, added, requested: ids.length });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
