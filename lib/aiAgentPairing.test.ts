import { beforeEach, describe, expect, it } from 'vitest';
import {
  AI_AGENT_PAIRING_TTL_MS,
  createAiAgentPairingCode,
  hashAiAgentPairingCode,
  normalizeAiAgentPairingCode,
} from './aiAgentPairing';

describe('AI agent pairing codes', () => {
  beforeEach(() => {
    process.env.AUTH_SECRET = 'test-pairing-secret';
  });

  it('creates human-readable 12-character codes with a ten-minute lifetime', () => {
    expect(createAiAgentPairingCode()).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    expect(AI_AGENT_PAIRING_TTL_MS).toBe(10 * 60 * 1000);
  });

  it('normalizes spacing and hyphens while rejecting ambiguous or malformed values', () => {
    expect(normalizeAiAgentPairingCode('abcd-efgh-jkmn')).toBe('ABCDEFGHJKMN');
    expect(normalizeAiAgentPairingCode('ABCD EFGH JKMN')).toBe('ABCDEFGHJKMN');
    expect(normalizeAiAgentPairingCode('ABCD-EFGH-IJKL')).toBeNull();
    expect(normalizeAiAgentPairingCode('too-short')).toBeNull();
  });

  it('stores only a stable keyed hash, never the entered code', async () => {
    const hash = await hashAiAgentPairingCode('ABCD-EFGH-JKMN');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(await hashAiAgentPairingCode('abcdefghjkmn'));
    expect(hash).not.toContain('ABCD');
  });
});
