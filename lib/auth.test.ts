import { afterEach, describe, expect, it, vi } from 'vitest';
import { authenticateUser, configuredUsers, createSessionToken, readSessionToken } from './auth';

const USERS = JSON.stringify([
  { id: '00000000-0000-4000-8000-000000000001', username: 'vamsi', password: 'owner-password' },
  { id: '00000000-0000-4000-8000-000000000002', username: 'surya', password: 'surya-test-password' },
  { id: '00000000-0000-4000-8000-000000000003', username: 'samitha', password: 'samitha-test-password' },
]);

afterEach(() => vi.unstubAllEnvs());

describe('fixed account auth', () => {
  it('authenticates the matching username/password without a shared password', () => {
    vi.stubEnv('APP_USERS_JSON', USERS);
    expect(authenticateUser('SURYA', 'surya-test-password')?.id).toBe('00000000-0000-4000-8000-000000000002');
    expect(authenticateUser('surya', 'owner-password')).toBeNull();
    expect(authenticateUser('SAMITHA', 'samitha-test-password')?.id).toBe('00000000-0000-4000-8000-000000000003');
    expect(configuredUsers()).toHaveLength(3);
  });

  it('signs the user identity and rejects tampered or expired sessions', async () => {
    vi.stubEnv('APP_USERS_JSON', USERS);
    vi.stubEnv('AUTH_SECRET', 'test-auth-secret-with-at-least-thirty-two-characters');
    const user = configuredUsers()[1];
    const token = await createSessionToken(user, 1_000);
    vi.spyOn(Date, 'now').mockReturnValue(2_000);
    expect((await readSessionToken(token))?.userId).toBe(user.id);
    expect(await readSessionToken(`${token}x`)).toBeNull();
    vi.spyOn(Date, 'now').mockReturnValue(1_000 + 31 * 24 * 60 * 60 * 1000);
    expect(await readSessionToken(token)).toBeNull();
    vi.restoreAllMocks();
  });
});
