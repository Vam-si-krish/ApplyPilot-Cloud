/** POST /api/auth/login — verify the shared password, set the session cookie. */
import { NextResponse } from 'next/server';
import { authenticateUser, createSessionToken, SESSION_COOKIE, SESSION_TTL_MS } from '@/lib/auth';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  let body: { username?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const user = authenticateUser(body.username || '', body.password || '');
  if (!user) {
    return NextResponse.json({ error: 'Incorrect username or password' }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true, user: { id: user.id, username: user.username, displayName: user.displayName } });
  res.cookies.set(SESSION_COOKIE, await createSessionToken(user), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
  return res;
}
