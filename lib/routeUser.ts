import { cookies } from 'next/headers';
import { checkCronAuth, configuredUsers, readSessionToken, SESSION_COOKIE } from './auth';

export async function authorizedRouteUser(req: Request): Promise<{ userId: string; isCron: boolean } | null> {
  const session = await readSessionToken(cookies().get(SESSION_COOKIE)?.value);
  if (session) return { userId: session.userId, isCron: false };
  if (!checkCronAuth(req)) return null;
  const userId = new URL(req.url).searchParams.get('user_id');
  return userId && configuredUsers().some((user) => user.id === userId) ? { userId, isCron: true } : null;
}
