import { describe, it, expect, vi, beforeEach } from 'vitest';

// Holder the mocked supabase reads from. `mock`-prefixed so vitest allows the
// factory below to reference it. maybeSingle() returns mockState.result, which
// each test sets to simulate "active row present" vs "no active row".
const mockState: { result: { data: unknown; error: unknown } } = { result: { data: null, error: null } };

vi.mock('./supabase', () => {
  // Chainable stub: from/select/eq return the builder; maybeSingle resolves the result.
  const builder: Record<string, unknown> = {};
  for (const m of ['from', 'select', 'eq']) builder[m] = () => builder;
  builder.maybeSingle = () => Promise.resolve(mockState.result);
  return { supabaseAdmin: () => builder };
});

import { maskKey, getActiveApiKey, isApiKeyProvider } from './credentials';

describe('maskKey', () => {
  it('keeps the last 4 chars and dots the rest', () => {
    expect(maskKey('apify_api_abcd1234')).toBe('••••••1234');
  });
  it('handles short keys without throwing', () => {
    expect(maskKey('ab')).toBe('••••••ab');
  });
});

describe('isApiKeyProvider', () => {
  it('accepts known providers and rejects others', () => {
    expect(isApiKeyProvider('apify')).toBe(true);
    expect(isApiKeyProvider('gemini')).toBe(true);
    expect(isApiKeyProvider('cohere')).toBe(false);
    expect(isApiKeyProvider(123)).toBe(false);
  });
});

describe('getActiveApiKey precedence', () => {
  const ENV = 'GEMINI_API_KEY';
  beforeEach(() => {
    mockState.result = { data: null, error: null };
    delete process.env[ENV];
  });

  it('prefers the active DB row over the env var', async () => {
    mockState.result = { data: { key_value: 'db-key' }, error: null };
    process.env[ENV] = 'env-key';
    expect(await getActiveApiKey('gemini')).toBe('db-key');
  });

  it('falls back to the env var when there is no active DB row', async () => {
    mockState.result = { data: null, error: null };
    process.env[ENV] = 'env-key';
    expect(await getActiveApiKey('gemini')).toBe('env-key');
  });

  it('returns null when neither DB nor env has a key', async () => {
    expect(await getActiveApiKey('gemini')).toBeNull();
  });
});
