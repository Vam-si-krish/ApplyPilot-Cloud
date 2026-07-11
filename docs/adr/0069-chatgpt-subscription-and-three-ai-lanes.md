# ADR 0069 — ChatGPT subscription backend + three independent AI lanes

**Status:** accepted (re-landed) · **Date:** 2026-07-10, re-landed 2026-07-11 · supersedes the
two-lane assignment in [ADR 0042](0042-ai-on-claude-subscription-via-agent-sdk.md), not its
Claude implementation

> **Re-land note (2026-07-11):** the original commit was reverted the same day
> ([ADR 0070](0070-revert-adr-0069-half-deploy.md)) because it reached Netlify with migration
> 0042 unapplied. Re-landed after the self-host cutover with migration-first ordering: the
> migration shipped in its own commit, applied automatically by the server laptop's autopull,
> then this code followed. Reviewed, re-tested (166 app + 3 worker tests) and validated against
> a live stack before the re-land; `AGENTS.md` from the original commit was not restored.

## Context

Settings had two provider/model lanes:

- `tailor_*` — résumé parse/tailor/condense + cover letters.
- `score_*` — job scoring, inbox classification, and ApplyBuddy chat.

Claude could run through the always-on worker's Agent SDK using the user's Claude subscription
(`provider='subscription'`) with no vault API key. The user wants the same option for a ChatGPT
subscription and wants ApplyBuddy replies independent from both high-volume scoring and premium
tailoring. The requested mental model is **AI Chat / Tailoring / Everything else**.

OpenAI's official authentication docs support `codex login` with ChatGPT for local Codex subscription
access, and the official TypeScript Codex SDK programmatically controls the local CLI. The docs recommend
API-key auth for conventional CI/CD automation; this app is instead a trusted, single-user local worker,
already protected by a shared secret and already the home of the Claude subscription backend. It must not
be exposed as a public/multi-user completion service.

## Decision

### Three lanes, backward-compatible schema

Add `settings.chat_provider` / `chat_model`. Migration 0042 backfills them from the existing complete
`score_*` pair, then the legacy `llm_*` pair, so ApplyBuddy does not change model merely because the
migration ran. Runtime resolution always chooses a **complete provider/model pair**:

- `chat`: `chat_*` → `score_*` → `llm_*` (rolling/pre-migration compatibility).
- `tailor`: `tailor_*` → `llm_*`.
- `score` (UI: Everything else): `score_*` → `llm_*`.

Only `/api/assistant` moves to the chat lane. Job scoring + Gmail classification stay in Everything else;
résumé structuring/tailoring/condensing + cover letters stay in Tailoring. The Settings UI shows the
cards in that order.

### A distinct ChatGPT subscription provider

Keep the existing DB id `subscription` as Claude forever for compatibility. Add
`chatgpt_subscription` for ChatGPT/Codex. Both are worker-only pseudo-providers and never enter the API-key
vault. `WorkerLLMClient` now sends the provider in `/llm`; the worker rejects any non-subscription provider
on that endpoint. Missing worker config or auth fails visibly and never falls back to `getClient()` or an
OpenAI API key.

The worker uses `@openai/codex-sdk` with its bundled CLI. One-time auth is an isolated
`CODEX_HOME=~/.applypilot-codex codex login`; the absolute directory is configured as
`CHATGPT_CODEX_HOME`. Each call starts a fresh thread with:

- read-only sandbox, `approval=never`, empty stable working directory;
- network + web search disabled; MCP emptied; project docs disabled;
- session history persistence disabled;
- API-key and custom base-URL environment variables stripped;
- low reasoning effort by default and a hard timeout.

The prompt wrapper explicitly makes Codex a no-tools text backend and preserves message order. Any emitted
tool item makes the call fail. Codex does not expose temperature/max-output controls through this SDK, so
the existing prompt/output validators remain the enforcement layer (including score parse-failure → 0).

### Cache discipline

Scoring and tailoring keep their existing three-message shape: stable system prompt, stable cache-marked
résumé block, volatile job block. The Codex wrapper flattens them **in that order**; no request id,
timestamp, or job data is prepended. OpenAI can therefore apply automatic stable-prefix caching.

ApplyBuddy's full profile system block is now `cache:true`. Direct Anthropic maps that to an explicit
`cache_control` breakpoint; Claude subscription folds it into its system prefix; OpenAI/Codex and other
compatible providers retain it as the first stable text. Codex SDK `cached_input_tokens` is persisted as
`cache_read_input_tokens`; its total input count is normalized to uncached input (`total - cached`) so the
existing usage UI does not double-count.

## Consequences

- The user can choose ChatGPT subscription independently for any of the three lanes without an API key.
- Scoring discipline is unchanged: exactly one model call per job; the same rubric/parser; errors and
  invalid output become visible score 0. A live scoring eval is still required before making a new Codex
  model the unattended production scoring default.
- Codex is primarily documented as a coding agent, so the wrapper/isolation is intentionally stricter than
  the Claude plain-text path. Model output quality/latency must be observed for résumé JSON and ApplyBuddy.
- ChatGPT plan limits and workspace model availability apply. Custom model input remains in Settings.
- Deploy order: worker code + `npm install` + `codex login`, migration 0042, then the web app. Worker
  `/version` advertises `chatgpt-subscription` so deployment can be checked before exposing the selector.

## Verification

- Main: typecheck, focused routing/cache tests, full Vitest suite, production build.
- Worker: `node --check`, `node --test`; config parsing smoke with history/MCP/project-doc overrides.
- Authenticated worker smoke: call `/llm` twice with the same stable prefix and confirm response text plus
  `usage.cache_read_input_tokens > 0` on the later call when the provider reports a hit.
- If Everything else uses ChatGPT subscription, run the scoring eval cases before unattended scoring.

## Official references

- [Codex authentication](https://developers.openai.com/codex/auth/)
- [Codex SDK](https://developers.openai.com/codex/sdk/)
- [Codex non-interactive mode](https://developers.openai.com/codex/noninteractive/)
