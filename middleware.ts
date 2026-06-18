import { NextRequest, NextResponse } from 'next/server';
import { verifySessionToken, SESSION_COOKIE } from '@/lib/auth';

// Paths reachable without a session:
//  - the login page + its auth endpoints
//  - the server-to-server pipeline endpoints, which authorize themselves via
//    CRON_SECRET / the webhook secret (ADR 0004). /api/run also accepts a
//    session and re-checks internally.
const PUBLIC_PATHS = ['/login', '/api/auth/login', '/api/auth/logout'];
const SELF_AUTH_PATHS = ['/api/run', '/api/apify-webhook', '/api/score-batch', '/api/assess-batch'];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.includes(pathname) || SELF_AUTH_PATHS.includes(pathname)) {
    return NextResponse.next();
  }

  const valid = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (valid) return NextResponse.next();

  // Unauthenticated: 401 for API, redirect to /login for pages.
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  return NextResponse.redirect(url);
}

export const config = {
  // Run on everything except Next internals and static files.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
