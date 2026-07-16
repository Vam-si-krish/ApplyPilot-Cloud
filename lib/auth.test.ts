import { afterEach, describe, expect, it, vi } from 'vitest';
import { authenticateUser, configuredUsers, createSessionToken, readSessionToken } from './auth';

const USERS = JSON.stringify([
  { id: '00000000-0000-4000-8000-000000000001', username: 'vamsi', password: 'owner-password' },
  { id: '00000000-0000-4000-8000-000000000002', username: 'surya', password: 'surya-test-password' },
  { id: '00000000-0000-4000-8000-000000000003', username: 'samitha', password: 'samitha-test-password' },
]);
const RISHAB = { id: '578fcb56-5900-4d0d-be20-6b6c191554b7', username: 'rishab', password: 'rishab-test-password', displayName: 'Rishab' };

afterEach(() => vi.unstubAllEnvs());

describe('fixed account auth', () => {
  it('authenticates the matching username/password without a shared password', () => {
    vi.stubEnv('APP_USERS_JSON', USERS);
    expect(authenticateUser('SURYA', 'surya-test-password')?.id).toBe('00000000-0000-4000-8000-000000000002');
    expect(authenticateUser('surya', 'owner-password')).toBeNull();
    expect(authenticateUser('SAMITHA', 'samitha-test-password')?.id).toBe('00000000-0000-4000-8000-000000000003');
    expect(configuredUsers()).toHaveLength(3);
  });

  it('accepts the production-only fourth account without requiring it in development', () => {
    vi.stubEnv('APP_USERS_JSON', JSON.stringify([...JSON.parse(USERS), RISHAB]));
    expect(authenticateUser('Rishab', 'rishab-test-password')?.id).toBe(RISHAB.id);
    expect(configuredUsers()).toHaveLength(4);
  });

  it('rejects replacing a baseline account with the optional fourth identity', () => {
    vi.stubEnv('APP_USERS_JSON', JSON.stringify([...JSON.parse(USERS).slice(0, 2), RISHAB]));
    expect(() => configuredUsers()).toThrow('retain all three baseline accounts');
  });

  it('rejects an unprovisioned fourth UUID', () => {
    vi.stubEnv('APP_USERS_JSON', JSON.stringify([
      ...JSON.parse(USERS),
      { ...RISHAB, id: '11111111-1111-4111-8111-111111111111' },
    ]));
    expect(() => configuredUsers()).toThrow('provisioned account migrations');
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
