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

## Built — multi-add modal + auto-rotate (follow-ups)
- **Add-key modal** (`<AddKeyModal/>` in the Settings page): each provider now has an explicit
  "Add <provider> key" button opening a popup where multiple keys can be entered (add/remove rows)
  and saved at once. Replaces the always-open inline form. One-active-at-a-time toggle unchanged.
- **Auto-rotate** (ADR 0007): `settings.auto_rotate_keys` (migration 0005) + a toggle at the top of
  the API Keys section. When on, `/api/run` calls `rotateAllActiveKeys()` once per run, advancing
  each provider with ≥2 keys to its next stored key (round-robin) before the Apify token / LLM key
  are read. Pure index math `nextRotationIndex` unit-tested.

## Applied to live DB (user provided Postgres password this session)
- `0004_api_keys.sql` and `0005_add_auto_rotate_keys.sql` run via psql against the project DB and
  verified (table/columns/indexes; settings.auto_rotate_keys present).

## Built — pre-scoring filter + manual re-trigger (ADR 0008)
- **Pre-filter** (`lib/prefilter.ts`): IDF-weighted coverage of the job's terms by the résumé — a
  cheap, local, no-API "% match". Computed once at ingestion (`/api/apify-webhook`) and stored on
  every job as `prefilter_score` (0–100). `/api/score-batch` gates on it: when
  `settings.prefilter_enabled`, jobs below `prefilter_threshold` become `status='filtered'` and skip
  the LLM (cuts token waste on irrelevant postings). Migration 0006 adds the `filtered` status,
  `prefilter_score`, and the two settings columns. UI: a "Pre-scoring Filter" settings section
  (toggle + threshold slider), a Filtered tab + inline "NN% match" on Jobs.
- **Manual re-trigger** (`POST /api/score-start`, session-gated): "Score unscored (N)" button on the
  Jobs page kicks `triggerScoreBatch()` to drain a stalled queue. Stats route now returns a
  `filtered` count and excludes filtered from `total`.

## Applied to live DB (this session)
- `0004_api_keys.sql`, `0005_add_auto_rotate_keys.sql`, `0006_prefilter.sql` — all run via psql and
  verified (constraint allows `filtered`; `prefilter_*` columns + defaults present).

## Next
1. Add real keys via Settings → API Keys; smoke-test the add-key modal (multi-row), activate/delete,
   and a manual run + scoring against the active keys.
2. Flip auto-rotate on with 2+ keys for a provider and confirm the active key advances each run.
3. Enable the pre-filter with a real résumé + run; tune the threshold against the shown match %; use
   "Score unscored" to resume after a forced stall.
4. If the app ever becomes multi-user, revisit encryption-at-rest + RLS before that (ADR 0006 note).
