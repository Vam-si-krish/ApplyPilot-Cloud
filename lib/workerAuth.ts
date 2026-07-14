import { currentUserId } from './userContext';

export function workerRequestHeaders(secret: string): Record<string, string> {
  const userId = currentUserId();
  if (!userId) throw new Error('Worker call requires an authenticated user');
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${secret}`,
    'x-jobpilot-user-id': userId,
  };
}
