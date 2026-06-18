/**
 * GET /api/gmail/auth — kick off Google OAuth (ADR 0012). Session-gated. Sets a
 * short-lived state cookie and redirects to Google's consent screen using the
 * stored client_id.
 */
import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { getGmailConnection } from '@/lib/db';
import { buildAuthUrl, GMAIL_REDIRECT_PATH } from '@/lib/gmail';
import { appBaseUrl } from '@/lib/pipeline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const conn = await getGmailConnection();
  if (!conn.client_id || !conn.client_secret) {
    return NextResponse.redirect(`${appBaseUrl()}/settings?gmail=missing_creds`);
  }
  const state = randomUUID();
  const url = buildAuthUrl(conn.client_id, `${appBaseUrl()}${GMAIL_REDIRECT_PATH}`, state);
  const res = NextResponse.redirect(url);
  res.cookies.set('gmail_oauth_state', state, { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 600, path: '/' });
  return res;
}
