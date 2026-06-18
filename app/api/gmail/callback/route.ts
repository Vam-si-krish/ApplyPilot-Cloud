/**
 * GET /api/gmail/callback — Google redirects here after consent (ADR 0012).
 * Session-gated (the user's browser carries the session cookie). Verifies the
 * state cookie, exchanges the code for a refresh token, stores it + the connected
 * email, and bounces back to Settings.
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getGmailConnection, updateGmailConnection } from '@/lib/db';
import { exchangeCode, getProfileEmail, GMAIL_REDIRECT_PATH } from '@/lib/gmail';
import { appBaseUrl } from '@/lib/pipeline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function back(status: string) {
  return NextResponse.redirect(`${appBaseUrl()}/settings?gmail=${status}`);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const cookieState = cookies().get('gmail_oauth_state')?.value;

  if (url.searchParams.get('error')) return back('denied');
  if (!code || !state || !cookieState || state !== cookieState) return back('auth_failed');

  const conn = await getGmailConnection();
  if (!conn.client_id || !conn.client_secret) return back('missing_creds');

  try {
    const tokens = await exchangeCode(conn.client_id, conn.client_secret, code, `${appBaseUrl()}${GMAIL_REDIRECT_PATH}`);
    const email = tokens.access_token ? await getProfileEmail(tokens.access_token) : null;
    // prompt=consent should always return a refresh_token; keep the old one if not.
    await updateGmailConnection({ refresh_token: tokens.refresh_token ?? conn.refresh_token, email });
    const res = back('connected');
    res.cookies.delete('gmail_oauth_state');
    return res;
  } catch {
    return back('error');
  }
}
