/** POST /api/gmail/disconnect — drop the OAuth token + connected account (ADR 0012).
 *  Keeps the client_id/secret so the user can reconnect without re-entering them. */
import { NextResponse } from 'next/server';
import { updateGmailConnection } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    await updateGmailConnection({ refresh_token: null, email: null, last_synced_at: null });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
