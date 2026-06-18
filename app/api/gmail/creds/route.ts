/**
 * GET/POST /api/gmail/creds — the Google OAuth app credentials (ADR 0012),
 * entered from Settings (vault-style) instead of env. Session-gated.
 *
 * GET returns connection status (never the secrets). POST stores client_id +
 * client_secret.
 */
import { NextResponse } from 'next/server';
import { getGmailConnection, updateGmailConnection } from '@/lib/db';
import type { GmailStatus } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const c = await getGmailConnection();
    const status: GmailStatus = {
      has_client_id: !!c.client_id,
      has_client_secret: !!c.client_secret,
      connected: !!c.refresh_token,
      email: c.email,
      last_synced_at: c.last_synced_at,
    };
    return NextResponse.json(status);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  let body: { client_id?: unknown; client_secret?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const patch: Record<string, string> = {};
  if (typeof body.client_id === 'string' && body.client_id.trim()) patch.client_id = body.client_id.trim();
  if (typeof body.client_secret === 'string' && body.client_secret.trim()) patch.client_secret = body.client_secret.trim();
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'client_id and/or client_secret required' }, { status: 400 });
  }
  try {
    await updateGmailConnection(patch);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
