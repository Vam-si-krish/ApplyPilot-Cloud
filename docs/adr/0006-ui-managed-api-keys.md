# ADR 0006 — UI-managed API key vault (multiple keys, switchable active)
**Status:** accepted · **Date:** 2026-06-17 · **Reverses:** the "secrets only in env" stance
## Context
Originally every provider secret (`GEMINI_API_KEY`, `APIFY_TOKEN`, …) was read from environment
variables only, and the Settings UI told the user to set them in Vercel "so secrets never touch the
database." Changing a key — or switching between **multiple accounts** (e.g. two Apify accounts to
spread quota) — meant editing Vercel env vars and redeploying. The user wants to manage all provider
keys from the Settings UI, keep several per provider, and flip which one is active at any time.
## Decision
Add an `api_keys` table (`supabase/migrations/0004_api_keys.sql`): `(id, provider, label, key_value,
is_active, created_at)`, with a partial unique index `where is_active` enforcing **at most one active
key per provider**. `lib/credentials.ts` is the single resolver: `getActiveApiKey(provider)` returns
the active row's secret, falling back to the legacy env var, then null — so an empty vault behaves
exactly as before. The scoring path (`/api/score-batch` → `makeClient` → `scoreJob(…, client)`) and
the Apify path (`lib/apify.ts` `client()`, now async) both read through this resolver. CRUD lives
behind `/api/keys` + `/api/keys/[id]`, gated by the existing password session (`middleware.ts`), and
the Settings UI gains an "API Keys" section.
## Security posture
Single-user, password-gated app; the `api_keys` table is reachable only server-side via the
service-role key. Keys are stored **plaintext** (no encryption at rest) — a deliberate trade-off for
simplicity, accepted because the service-role boundary already guards everything. The browser only
ever receives a **masked preview** (last 4 chars); the raw secret never leaves the server after save.
## Alternatives considered
- **Keep env-only** — rejected: the whole point is UI management + multi-account switching.
- **Encrypt at rest (AES-GCM via AUTH_SECRET)** — deferred: more defense-in-depth, but adds a crypto
  helper and a hard dependency on the secret; not warranted for a single-user app behind one password.
- **One key per provider (overwrite on change)** — rejected: loses the "multiple accounts, pick active"
  requirement that motivated the feature.
## Notes
Env vars remain documented in `.env.example` as optional fallbacks. If the vault is ever exposed to
more than one user, revisit encryption-at-rest and per-user RLS before doing so.
