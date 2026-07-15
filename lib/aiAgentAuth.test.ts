import { beforeEach, describe, expect, it } from 'vitest';
import { AI_AGENT_TOKEN_PREFIX, createAiAgentToken, readAiAgentToken } from './aiAgentAuth';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '00000000-0000-4000-8000-000000000002';

describe('AI agent run tokens', () => {
  beforeEach(() => {
    process.env.AUTH_SECRET = 'test-only-auth-secret-that-is-long-enough';
  });

  it('round-trips purpose-bound user/run claims', async () => {
    const expiresAt = Date.now() + 60_000;
    const token = await createAiAgentToken(RUN_ID, USER_ID, expiresAt);
    expect(token).toMatch(new RegExp(`^${AI_AGENT_TOKEN_PREFIX}`));
    await expect(readAiAgentToken(token)).resolves.toEqual({
      version: 1,
      purpose: 'ai-apply-run',
      runId: RUN_ID,
      userId: USER_ID,
      expiresAt,
    });
  });

  it('rejects tampering, expiry, and session-shaped credentials', async () => {
    const expiresAt = Date.now() + 60_000;
    const token = await createAiAgentToken(RUN_ID, USER_ID, expiresAt);
    const last = token.at(-1) === 'a' ? 'b' : 'a';
    await expect(readAiAgentToken(`${token.slice(0, -1)}${last}`)).resolves.toBeNull();
    await expect(readAiAgentToken(token, expiresAt)).resolves.toBeNull();
    await expect(readAiAgentToken('session.payload.signature')).resolves.toBeNull();
  });
});
