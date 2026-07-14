import { AsyncLocalStorage } from 'node:async_hooks';
import { headers } from 'next/headers';

const users = new AsyncLocalStorage<string>();

/** Verified user id injected by middleware, or an explicit background-job context. */
export function currentUserId(): string | null {
  const stored = users.getStore();
  if (stored) return stored;
  try {
    return headers().get('x-jobpilot-user-id');
  } catch {
    return null;
  }
}

export function runAsUser<T>(userId: string, work: () => T): T {
  return users.run(userId, work);
}
