/**
 * Unified LLM client for ApplyPilot-Cloud.
 *
 * Direct port of ../ApplyPilot-Lite/src/applypilot/llm.py — same providers,
 * same retry/back-off, same Gemini compat→native fallback. Auto-detects the
 * provider from environment:
 *
 *   GEMINI_API_KEY     -> Google Gemini (default: gemini-2.0-flash)
 *   OPENAI_API_KEY     -> OpenAI (default: gpt-4o-mini)
 *   DEEPSEEK_API_KEY   -> DeepSeek (default: deepseek-chat)
 *   ANTHROPIC_API_KEY  -> Anthropic (default: claude-haiku-4-5-20251001)
 *
 * LLM_PROVIDER pins one explicitly; LLM_MODEL overrides the model name.
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ProviderConfig {
  baseUrl: string;
  defaultModel: string;
  envVar: string;
}

// provider id -> (base_url, default_model, env_var_for_key)
const PROVIDER_TABLE: Record<string, ProviderConfig> = {
  gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/v1',
    defaultModel: 'gemini-2.0-flash',
    envVar: 'GEMINI_API_KEY',
  },
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    envVar: 'OPENAI_API_KEY',
  },
  deepseek: {
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    envVar: 'DEEPSEEK_API_KEY',
  },
  anthropic: {
    baseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-haiku-4-5-20251001',
    envVar: 'ANTHROPIC_API_KEY',
  },
};

const GEMINI_NATIVE_BASE = 'https://generativelanguage.googleapis.com/v1beta';

const MAX_RETRIES = 5;
const TIMEOUT_MS = 120_000;
// Base wait on first 429/503 (doubles each retry, caps at 60s).
// Gemini free tier is 15 RPM = 4s minimum between requests; 10s gives headroom.
const RATE_LIMIT_BASE_WAIT_MS = 10_000;

interface ResolvedProvider {
  baseUrl: string;
  model: string;
  apiKey: string;
}

/** Return {baseUrl, model, apiKey} based on environment variables. */
export function detectProvider(env: Record<string, string | undefined> = process.env): ResolvedProvider {
  const modelOverride = (env.LLM_MODEL || '').trim();
  const pinned = (env.LLM_PROVIDER || '').trim().toLowerCase();

  if (pinned in PROVIDER_TABLE) {
    const cfg = PROVIDER_TABLE[pinned];
    const key = env[cfg.envVar] || '';
    if (key) {
      return { baseUrl: cfg.baseUrl, model: modelOverride || cfg.defaultModel, apiKey: key };
    }
  }

  // Fallback: first provider with a key, preferring the historical order.
  for (const pid of ['gemini', 'openai', 'deepseek', 'anthropic'] as const) {
    const cfg = PROVIDER_TABLE[pid];
    const key = env[cfg.envVar] || '';
    if (key) {
      return { baseUrl: cfg.baseUrl, model: modelOverride || cfg.defaultModel, apiKey: key };
    }
  }

  throw new Error(
    'No LLM provider configured. Set GEMINI_API_KEY / OPENAI_API_KEY / ' +
      'DEEPSEEK_API_KEY / ANTHROPIC_API_KEY in the environment.',
  );
}

/** Sentinel: Gemini OpenAI-compat returned 403/404. Switch to native API. */
class GeminiCompatForbidden extends Error {}

class HttpStatusError extends Error {
  constructor(
    public status: number,
    public headers: Headers,
    public body: string,
  ) {
    super(`HTTP ${status}: ${body.slice(0, 200)}`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
}

export class LLMClient {
  private isGemini: boolean;
  private isAnthropic: boolean;
  // True once we've confirmed the native Gemini API is needed for this model.
  private useNativeGemini = false;

  constructor(
    private baseUrl: string,
    public model: string,
    private apiKey: string,
  ) {
    this.isGemini = baseUrl.includes('generativelanguage.googleapis.com');
    this.isAnthropic = baseUrl.includes('api.anthropic.com');
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(t);
    }
  }

  // -- Anthropic Messages API --------------------------------------------------
  private async chatAnthropic(messages: ChatMessage[], temperature: number, maxTokens: number): Promise<string> {
    const systemText: string[] = [];
    const anthMessages: { role: 'user' | 'assistant'; content: string }[] = [];
    for (const msg of messages) {
      if (msg.role === 'system') systemText.push(msg.content);
      else anthMessages.push({ role: msg.role === 'user' ? 'user' : 'assistant', content: msg.content });
    }

    const payload: Record<string, unknown> = {
      model: this.model,
      max_tokens: maxTokens,
      temperature,
      messages: anthMessages,
    };
    if (systemText.length) payload.system = systemText.join('\n\n');

    const resp = await this.fetchWithTimeout('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) throw new HttpStatusError(resp.status, resp.headers, await resp.text());
    const data = await resp.json();
    const parts = (data.content || [])
      .filter((b: { type?: string }) => b.type === 'text')
      .map((b: { text?: string }) => b.text || '');
    return parts.join('');
  }

  // -- Native Gemini API -------------------------------------------------------
  private async chatNativeGemini(messages: ChatMessage[], temperature: number, maxTokens: number): Promise<string> {
    const contents: { role: 'user' | 'model'; parts: { text: string }[] }[] = [];
    const systemParts: { text: string }[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') systemParts.push({ text: msg.content });
      else if (msg.role === 'user') contents.push({ role: 'user', parts: [{ text: msg.content }] });
      else if (msg.role === 'assistant') contents.push({ role: 'model', parts: [{ text: msg.content }] });
    }

    const payload: Record<string, unknown> = {
      contents,
      generationConfig: { temperature, maxOutputTokens: maxTokens },
    };
    if (systemParts.length) payload.systemInstruction = { parts: systemParts };

    const url = `${GEMINI_NATIVE_BASE}/models/${this.model}:generateContent?key=${encodeURIComponent(this.apiKey)}`;
    const resp = await this.fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) throw new HttpStatusError(resp.status, resp.headers, await resp.text());
    const data = await resp.json();
    return data.candidates[0].content.parts[0].text;
  }

  // -- OpenAI-compat API -------------------------------------------------------
  private async chatCompat(messages: ChatMessage[], temperature: number, maxTokens: number): Promise<string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;

    const resp = await this.fetchWithTimeout(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: this.model, messages, temperature, max_tokens: maxTokens }),
    });

    // 403/404 on Gemini compat = model not on the compat layer — switch to native.
    if ((resp.status === 403 || resp.status === 404) && this.isGemini) {
      throw new GeminiCompatForbidden(await resp.text());
    }
    if (!resp.ok) throw new HttpStatusError(resp.status, resp.headers, await resp.text());
    const data = await resp.json();
    return data.choices[0].message.content;
  }

  // -- public API --------------------------------------------------------------
  async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
    const temperature = opts.temperature ?? 0.0;
    const maxTokens = opts.maxTokens ?? 4096;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        if (this.isAnthropic) return await this.chatAnthropic(messages, temperature, maxTokens);
        if (this.useNativeGemini) return await this.chatNativeGemini(messages, temperature, maxTokens);
        return await this.chatCompat(messages, temperature, maxTokens);
      } catch (err) {
        if (err instanceof GeminiCompatForbidden) {
          // Model not on the OpenAI-compat layer — switch to native and retry now.
          this.useNativeGemini = true;
          try {
            return await this.chatNativeGemini(messages, temperature, maxTokens);
          } catch (nativeErr) {
            const s = nativeErr instanceof HttpStatusError ? `${nativeErr.status} — ${nativeErr.body.slice(0, 200)}` : String(nativeErr);
            throw new Error(`Both Gemini endpoints failed. Compat: 403/404. Native: ${s}`);
          }
        }

        if (err instanceof HttpStatusError && (err.status === 429 || err.status === 503) && attempt < MAX_RETRIES - 1) {
          // Respect Retry-After if provided (Gemini sends this).
          const retryAfter = err.headers.get('Retry-After') || err.headers.get('X-RateLimit-Reset-Requests');
          let wait: number;
          if (retryAfter) {
            const parsed = parseFloat(retryAfter);
            wait = Number.isNaN(parsed) ? RATE_LIMIT_BASE_WAIT_MS * 2 ** attempt : parsed * 1000;
          } else {
            wait = Math.min(RATE_LIMIT_BASE_WAIT_MS * 2 ** attempt, 60_000);
          }
          await sleep(wait);
          continue;
        }

        // AbortError (timeout): retry with back-off.
        if (err instanceof Error && err.name === 'AbortError' && attempt < MAX_RETRIES - 1) {
          await sleep(Math.min(RATE_LIMIT_BASE_WAIT_MS * 2 ** attempt, 60_000));
          continue;
        }

        throw err;
      }
    }
    throw new Error('LLM request failed after all retries');
  }
}

/**
 * Build a client from an explicit provider + model + key (the API-key-vault path,
 * ADR 0006). baseUrl comes from PROVIDER_TABLE; an unknown provider falls back to
 * the OpenAI-compat base. Used by the scoring path once the active key is resolved.
 */
export function makeClient(provider: string, model: string, apiKey: string): LLMClient {
  const cfg = PROVIDER_TABLE[provider.trim().toLowerCase()] ?? PROVIDER_TABLE.openai;
  return new LLMClient(cfg.baseUrl, (model || '').trim() || cfg.defaultModel, apiKey);
}

let _instance: LLMClient | null = null;

/** Return (or create) the module-level LLMClient singleton. */
export function getClient(): LLMClient {
  if (!_instance) {
    const { baseUrl, model, apiKey } = detectProvider();
    _instance = new LLMClient(baseUrl, model, apiKey);
  }
  return _instance;
}

/** Reset the singleton (tests / settings changes). */
export function resetClient(): void {
  _instance = null;
}
