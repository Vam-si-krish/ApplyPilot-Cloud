import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  CHATGPT_SUBSCRIPTION_PROVIDER,
  detectProvider,
  isSubscriptionProvider,
  makeWorkerClient,
  WorkerLLMClient,
} from './llm';

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

describe('WorkerLLMClient (subscription modes, ADR 0042/0069)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('POSTs messages + model to the worker /llm with the Bearer secret and returns text', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      new Response(JSON.stringify({ text: 'SCORE: 7' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = makeWorkerClient('https://worker.example.com/', 'shh-secret', 'haiku');
    const messages = [
      { role: 'system' as const, content: 'be terse' },
      { role: 'user' as const, content: 'rate this' },
    ];
    const out = await client.chat(messages, { temperature: 0.1, maxTokens: 1000 });

    expect(out).toBe('SCORE: 7');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://worker.example.com/llm'); // trailing slash collapsed
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer shh-secret');
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ provider: 'subscription', model: 'haiku', temperature: 0.1, maxTokens: 1000, messages });
  });

  it('defaults the model to sonnet when blank', () => {
    expect(new WorkerLLMClient('u', 's', '').model).toBe('sonnet');
    expect(makeWorkerClient('u', 's', '   ').model).toBe('sonnet');
  });

  it('routes ChatGPT subscription calls explicitly and defaults to GPT-5.4', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      new Response(JSON.stringify({ text: 'ready' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = makeWorkerClient('https://worker.example.com', 's', '', CHATGPT_SUBSCRIPTION_PROVIDER);
    expect(client.model).toBe('gpt-5.4');
    expect(client.subscriptionProvider).toBe(CHATGPT_SUBSCRIPTION_PROVIDER);
    expect(isSubscriptionProvider(CHATGPT_SUBSCRIPTION_PROVIDER)).toBe(true);
    await client.chat([{ role: 'user', content: 'hi' }]);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toMatchObject({ provider: CHATGPT_SUBSCRIPTION_PROVIDER, model: 'gpt-5.4' });
  });

  it('surfaces the worker error message on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'not logged in' }), { status: 500 })));
    const client = makeWorkerClient('https://worker.example.com', 's', 'sonnet');
    await expect(client.chat([{ role: 'user', content: 'hi' }])).rejects.toThrow(/not logged in/);
  });

  it('reports an unreachable worker clearly', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('fetch failed'); }));
    const client = makeWorkerClient('https://worker.example.com', 's', 'sonnet');
    await expect(client.chat([{ role: 'user', content: 'hi' }])).rejects.toThrow(/Could not reach the worker/);
  });
});
