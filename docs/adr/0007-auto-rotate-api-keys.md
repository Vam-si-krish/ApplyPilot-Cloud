# ADR 0007 — Auto-rotate API keys per run
**Status:** accepted · **Date:** 2026-06-17 · **Builds on:** ADR 0006 (key vault)
## Context
The vault (ADR 0006) lets the user store multiple keys per provider and pick one active. With
several accounts (e.g. multiple Apify or LLM keys) the user wants to **spread usage across them
automatically** rather than flipping the active key by hand, to stay under per-account quotas.
## Decision
Add `settings.auto_rotate_keys` (migration 0005, default false). When true, `/api/run` calls
`rotateAllActiveKeys()` **once at the start of every run** — before it reads the Apify token and
before scoring reads the LLM key — advancing each provider that has ≥2 keys to its next stored key
(round-robin by `created_at`). Rotation lives in `lib/credentials.ts` (`rotateActiveKey` /
`rotateAllActiveKeys`), reusing the same "exactly one active per provider" invariant; the pure
index math (`nextRotationIndex`) is unit-tested. When false, the manually chosen active key is used
(ADR 0006 behaviour, unchanged).
## Why at run start (not per scoring batch)
A run fans out into one Apify actor per portal and many `/api/score-batch` invocations. Rotating at
run start means the **whole run uses one key per provider**; `score-batch` keeps reading the active
key fresh each invocation, so all batches in a run agree. Rotating inside `score-batch` would shift
the key mid-run (once per chunk), which is not the intent.
## Alternatives considered
- **Rotate only the active LLM provider + Apify** — narrower, but "advance every provider with ≥2
  keys" is simpler to explain and harmless for unused providers (a no-op at <2 keys).
- **Per-request rotation / least-recently-used** — rejected: more state, and "one key per run" is the
  natural unit the user reasons about.
- **Weighted/quota-aware selection** — deferred: needs usage tracking we don't have.
## Notes
The active badge in Settings still reflects the current key, so after each run the user can see which
account ran. Toggling auto-rotate persists immediately via the settings PUT (partial update).
