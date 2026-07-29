import { afterEach, describe, expect, it, vi } from 'vitest';
import { authenticateUser, configuredUsers, createSessionToken, readSessionToken } from './auth';

const USERS = JSON.stringify([
  { id: '00000000-0000-4000-8000-000000000001', username: 'vamsi', password: 'owner-password' },
  { id: '00000000-0000-4000-8000-000000000002', username: 'surya', password: 'surya-test-password' },
  { id: '00000000-0000-4000-8000-000000000003', username: 'samitha', password: 'samitha-test-password' },
]);
const RISHAB = { id: '578fcb56-5900-4d0d-be20-6b6c191554b7', username: 'rishab', password: 'rishab-test-password', displayName: 'Rishab' };
const RUBY = { id: 'e434e565-6be0-4c9e-b396-0f2323cf6045', username: 'ruby', password: 'ruby-1', displayName: 'Ruby' };

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

  it('accepts Ruby as a fifth production-only account with the owner-approved six-character password', () => {
    vi.stubEnv('APP_USERS_JSON', JSON.stringify([...JSON.parse(USERS), RISHAB, RUBY]));
    expect(authenticateUser('Ruby', 'ruby-1')?.id).toBe(RUBY.id);
    expect(authenticateUser('Ruby', 'ruby-2')).toBeNull();
    expect(configuredUsers()).toHaveLength(5);
  });

  it('does not weaken the ten-character password minimum for other accounts', () => {
    vi.stubEnv('APP_USERS_JSON', JSON.stringify([
      ...JSON.parse(USERS),
      { ...RISHAB, password: 'short1' },
    ]));
    expect(() => configuredUsers()).toThrow('at least 10 characters');
  });

  it('rejects a Ruby password shorter than the bounded six-character exception', () => {
    vi.stubEnv('APP_USERS_JSON', JSON.stringify([
      ...JSON.parse(USERS),
      RISHAB,
      { ...RUBY, password: '12345' },
    ]));
    expect(() => configuredUsers()).toThrow('at least 6 characters');
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
