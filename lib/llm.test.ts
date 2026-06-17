import { describe, it, expect } from 'vitest';
import { detectProvider } from './llm';

describe('detectProvider', () => {
  it('picks Gemini by default when only GEMINI_API_KEY is set', () => {
    const r = detectProvider({ GEMINI_API_KEY: 'g' });
    expect(r.baseUrl).toContain('generativelanguage.googleapis.com');
    expect(r.model).toBe('gemini-2.0-flash');
    expect(r.apiKey).toBe('g');
  });

  it('prefers gemini over others when multiple keys are present', () => {
    const r = detectProvider({ OPENAI_API_KEY: 'o', GEMINI_API_KEY: 'g' });
    expect(r.model).toBe('gemini-2.0-flash');
  });

  it('honors LLM_PROVIDER pin when its key exists', () => {
    const r = detectProvider({ GEMINI_API_KEY: 'g', OPENAI_API_KEY: 'o', LLM_PROVIDER: 'openai' });
    expect(r.baseUrl).toBe('https://api.openai.com/v1');
    expect(r.model).toBe('gpt-4o-mini');
    expect(r.apiKey).toBe('o');
  });

  it('falls back to the first available key when the pinned provider has no key', () => {
    const r = detectProvider({ LLM_PROVIDER: 'anthropic', DEEPSEEK_API_KEY: 'd' });
    expect(r.baseUrl).toBe('https://api.deepseek.com/v1');
    expect(r.model).toBe('deepseek-chat');
  });

  it('applies LLM_MODEL override', () => {
    const r = detectProvider({ GEMINI_API_KEY: 'g', LLM_MODEL: 'gemini-2.5-pro' });
    expect(r.model).toBe('gemini-2.5-pro');
  });

  it('resolves the Anthropic default model', () => {
    const r = detectProvider({ ANTHROPIC_API_KEY: 'a' });
    expect(r.baseUrl).toBe('https://api.anthropic.com/v1');
    expect(r.model).toBe('claude-haiku-4-5-20251001');
  });

  it('throws a clear error when no provider key is set', () => {
    expect(() => detectProvider({})).toThrow(/No LLM provider configured/);
  });
});
