# Devlog — Day 2 (2026-06-17)

## Ran
- Read the brief from the user: manage all provider API keys (Gemini, OpenAI, DeepSeek,
  Anthropic, **and Apify**) from the Settings UI, store **multiple keys per provider**
  (think: several Apify accounts), and switch which one is **active** at any time.
- Studied the full key path before touching code: `lib/llm.ts` (env-only `detectProvider`/
  `getClient`), `lib/scoring.ts` (`scoreJob` → `getClient`), `lib/apify.ts` (`client()` reads
  `APIFY_TOKEN`), the `score-batch`/`run`/`apify-webhook` routes, and the Settings page/route.

## Built — API key vault (ADR 0006)
This **reverses** the documented "secrets only in env" stance. New ADR 0006 records the
trade-off (single-user, password-gated; plaintext in a service-role-only table; masked in
transit; env retained as fallback).

1. **Migration** `0004_api_keys.sql` — `api_keys(id, provider, label, key_value, is_active,
   created_at)` + partial unique index `where is_active` → at most one active key per provider.
   **User must run this in the Supabase SQL editor** (same as 0001–0003).
2. **`lib/credentials.ts`** — single resolver `getActiveApiKey(provider)` (active DB row →
   env var → null) + CRUD (`list/create/activate/delete`, masking, first-key auto-activate,
   promote-newest-on-delete). Server-only.
3. **Runtime wiring** — `makeClient(provider, model, key)` in `lib/llm.ts`; `scoreJob(…, client?)`
   optional 3rd arg (back-compatible); `score-batch` builds the client once from settings +
   active key; `lib/apify.ts` `client()` is now async and resolves via the vault. `getClient`/
   `detectProvider` left intact as the env fallback (and for existing tests).
4. **Routes** `/api/keys` (GET masked list, POST create) + `/api/keys/[id]` (PATCH activate,
   DELETE) — gated by the existing password session via `middleware.ts`.
5. **Settings UI** — new self-contained `<ApiKeysSection />`: keys grouped by provider, each
   row has an active toggle + masked preview + delete, with a per-provider add form. The two
   old "keys live in env" notes now point at this section (env = fallback).

## Verified
- `npm run typecheck`, `npm run build`, `npm run test` — green (see end-of-session run).
- New `lib/credentials.test.ts` covers `maskKey` + `getActiveApiKey` precedence (DB > env > null).

## Not exercised against live services
- The vault → run/score path is unit/build-verified only. End-to-end (add a key in the UI,
  flip active, trigger a run, see it use the new token/key) needs a live Supabase + Apify + LLM,
  same caveat as Day 1's pipeline.

## Next
1. Run `0004_api_keys.sql` in Supabase; add real keys via Settings → API Keys; smoke-test
   activate/delete and a manual run + scoring against the active keys.
2. If the app ever becomes multi-user, revisit encryption-at-rest + RLS before that (ADR 0006 note).
