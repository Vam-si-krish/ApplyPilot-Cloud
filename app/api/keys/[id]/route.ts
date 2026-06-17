/**
 * PATCH/DELETE /api/keys/[id] — activate or remove a stored key (ADR 0006).
 * Gated by the password session in middleware.ts.
 *
 * PATCH { action: 'activate' } makes this key the active one for its provider
 * (and deactivates its siblings). DELETE removes it, auto-promoting the newest
 * remaining key of that provider if the deleted one was active.
 */
import { NextResponse } from 'next/server';
import { activateApiKey, deleteApiKey } from '@/lib/credentials';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  let body: { action?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  if (body.action !== 'activate') {
    return NextResponse.json({ error: 'unsupported action' }, { status: 400 });
  }
  try {
    await activateApiKey(params.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    await deleteApiKey(params.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
