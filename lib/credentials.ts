/**
 * API key vault (ADR 0006). Single source of truth for "which key is active"
 * for each provider, with an automatic environment-variable fallback so an empty
 * vault keeps the env-based behaviour from before this feature.
 *
 * Keys are stored plaintext in the api_keys table, reachable only server-side via
 * the service-role client. The browser only ever receives a masked preview — see
 * listApiKeys / maskKey. This module is SERVER-ONLY (imports supabaseAdmin).
 */
import { supabaseAdmin } from './supabase';
import type { ApiKey, ApiKeyMasked, ApiKeyProvider } from './types';

export const API_KEY_PROVIDERS: ApiKeyProvider[] = ['gemini', 'openai', 'deepseek', 'anthropic', 'apify'];

/** Provider -> the legacy env var used as a fallback when the vault has no active key. */
const PROVIDER_ENV: Record<ApiKeyProvider, string> = {
  gemini: 'GEMINI_API_KEY',
  openai: 'OPENAI_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  apify: 'APIFY_TOKEN',
};

export function isApiKeyProvider(v: unknown): v is ApiKeyProvider {
  return typeof v === 'string' && (API_KEY_PROVIDERS as string[]).includes(v);
}

/** Mask a secret for display: keep the last 4 chars, dot out the rest. */
export function maskKey(value: string): string {
  const tail = value.slice(-4);
  return `••••••${tail}`;
}

function toMasked(row: ApiKey): ApiKeyMasked {
  return {
    id: row.id,
    provider: row.provider,
    label: row.label,
    key_preview: maskKey(row.key_value),
    is_active: row.is_active,
    created_at: row.created_at,
  };
}

/**
 * The key to use for a provider right now: the active vault row's secret, else
 * the legacy env var, else null. Used by the run/scoring paths.
 */
export async function getActiveApiKey(provider: ApiKeyProvider): Promise<string | null> {
  const { data, error } = await supabaseAdmin()
    .from('api_keys')
    .select('key_value')
    .eq('provider', provider)
    .eq('is_active', true)
    .maybeSingle();
  if (error) throw new Error(`Failed to load active ${provider} key: ${error.message}`);
  const fromDb = (data?.key_value as string | undefined)?.trim();
  if (fromDb) return fromDb;
  const fromEnv = (process.env[PROVIDER_ENV[provider]] || '').trim();
  return fromEnv || null;
}

/** All vault rows (masked), newest first. */
export async function listApiKeys(): Promise<ApiKeyMasked[]> {
  const { data, error } = await supabaseAdmin()
    .from('api_keys')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Failed to list api keys: ${error.message}`);
  return ((data ?? []) as ApiKey[]).map(toMasked);
}

/** Insert a key. Auto-activates it if it's the first key for its provider. */
export async function createApiKey(provider: ApiKeyProvider, label: string, value: string): Promise<ApiKeyMasked> {
  const { count, error: countErr } = await supabaseAdmin()
    .from('api_keys')
    .select('id', { count: 'exact', head: true })
    .eq('provider', provider);
  if (countErr) throw new Error(`Failed to count ${provider} keys: ${countErr.message}`);

  const { data, error } = await supabaseAdmin()
    .from('api_keys')
    .insert({ provider, label: label.trim(), key_value: value.trim(), is_active: (count ?? 0) === 0 })
    .select('*')
    .single();
  if (error) throw new Error(`Failed to create api key: ${error.message}`);
  return toMasked(data as ApiKey);
}

/** Make one key active and deactivate the rest of its provider. */
export async function activateApiKey(id: string): Promise<void> {
  const { data: row, error: getErr } = await supabaseAdmin()
    .from('api_keys')
    .select('provider')
    .eq('id', id)
    .single();
  if (getErr) throw new Error(`Failed to find api key: ${getErr.message}`);

  // Two steps so the partial unique index (one active per provider) never trips mid-update.
  const { error: offErr } = await supabaseAdmin()
    .from('api_keys')
    .update({ is_active: false })
    .eq('provider', (row as { provider: string }).provider);
  if (offErr) throw new Error(`Failed to deactivate keys: ${offErr.message}`);

  const { error: onErr } = await supabaseAdmin().from('api_keys').update({ is_active: true }).eq('id', id);
  if (onErr) throw new Error(`Failed to activate api key: ${onErr.message}`);
}

/**
 * The round-robin target: the index after the current active one, wrapping. Pure
 * (no DB) so it's unit-testable. Returns -1 for an empty set; 0 when nothing is
 * active yet.
 */
export function nextRotationIndex(count: number, currentActiveIndex: number): number {
  if (count <= 0) return -1;
  if (currentActiveIndex < 0) return 0;
  return (currentActiveIndex + 1) % count;
}

/**
 * Advance a provider's active key to the next stored one (round-robin by
 * created_at). No-op when the provider has fewer than 2 keys. Used by the run
 * path when auto-rotate is on (ADR 0007).
 */
export async function rotateActiveKey(provider: ApiKeyProvider): Promise<void> {
  const { data, error } = await supabaseAdmin()
    .from('api_keys')
    .select('id, is_active')
    .eq('provider', provider)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`Failed to load ${provider} keys for rotation: ${error.message}`);

  const rows = (data ?? []) as { id: string; is_active: boolean }[];
  if (rows.length < 2) return; // nothing to rotate

  const currIdx = rows.findIndex((r) => r.is_active);
  const nextId = rows[nextRotationIndex(rows.length, currIdx)].id;
  if (rows[currIdx]?.id === nextId) return; // already on the target

  const { error: offErr } = await supabaseAdmin().from('api_keys').update({ is_active: false }).eq('provider', provider);
  if (offErr) throw new Error(`Failed to deactivate ${provider} keys: ${offErr.message}`);
  const { error: onErr } = await supabaseAdmin().from('api_keys').update({ is_active: true }).eq('id', nextId);
  if (onErr) throw new Error(`Failed to activate next ${provider} key: ${onErr.message}`);
}

/** Rotate every provider (each is a no-op with <2 keys). Called once per run. */
export async function rotateAllActiveKeys(): Promise<void> {
  for (const p of API_KEY_PROVIDERS) await rotateActiveKey(p);
}

/** Delete a key. If it was the active one, promote the newest remaining of its provider. */
export async function deleteApiKey(id: string): Promise<void> {
  const { data: row, error: getErr } = await supabaseAdmin()
    .from('api_keys')
    .select('provider, is_active')
    .eq('id', id)
    .maybeSingle();
  if (getErr) throw new Error(`Failed to find api key: ${getErr.message}`);
  if (!row) return; // already gone

  const { error: delErr } = await supabaseAdmin().from('api_keys').delete().eq('id', id);
  if (delErr) throw new Error(`Failed to delete api key: ${delErr.message}`);

  if ((row as { is_active: boolean }).is_active) {
    const provider = (row as { provider: string }).provider;
    const { data: next } = await supabaseAdmin()
      .from('api_keys')
      .select('id')
      .eq('provider', provider)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (next?.id) {
      await supabaseAdmin().from('api_keys').update({ is_active: true }).eq('id', next.id as string);
    }
  }
}
