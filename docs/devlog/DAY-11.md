# DAY 11 — 2026-07-10

## ✅ ChatGPT subscription + three independent AI lanes (ADR 0069)

Added the requested Settings model: **AI Chat / Tailoring / Everything else**. ApplyBuddy no longer shares
the scoring model. Migration 0042 adds `chat_provider/chat_model` and backfills them from the current scoring
pair, preserving the exact pre-migration behavior. Runtime fallback selects complete pairs, so a partial
rolling deploy cannot combine (for example) a ChatGPT provider with a Claude model.

Added `chatgpt_subscription` alongside the legacy Claude `subscription` id. The cloud sends the selected
provider to worker `/llm`; both app and worker recognize subscription providers explicitly and never route
them through the API-key vault or silently fall back to an environment key. Manual subscription scoring
delegation now works for either provider.

Worker implementation: official `@openai/codex-sdk`, authenticated once with `codex login`. It strips API
billing credentials/base URLs, runs read-only/no-network/no-tools in a stable empty directory, disables
MCP/project instructions/session persistence, uses low reasoning + a timeout, rejects any emitted tool call,
and captures tokens. Codex's total input is normalized to uncached input + cache read so existing usage
display semantics stay correct.

Caching: scoring/tailoring stable-prefix order is unchanged. ApplyBuddy's profile-heavy system message is now
cache-marked; direct Anthropic receives a real breakpoint, while Claude Agent SDK / OpenAI Codex retain the
same stable first prefix for automatic caching.

Verification so far:

- `npm run typecheck` clean.
- Focused Vitest: 57 passed (LLM worker payload/routing, three-lane fallback, assistant cache marker, scoring
  and tailoring prompt regression tests).
- Worker: 3 Node tests passed; `node --check` clean for chatgptClient/server/agentClient.
- Codex config parsing accepted `history.persistence=none`, project-doc disable, and empty MCP overrides.
- Authenticated subscription smoke returned the exact sentinel. A cache-threshold smoke captured an
  **8,192-token cache read** on one call (and a normal miss on another), confirming usage normalization
  and observability without pretending every request must hit the provider cache.
- Full Vitest: **166 passed / 8 live-provider cases skipped**; production `next build` clean.

Production still needs worker redeploy + isolated `codex login`, migration 0042, and then the app deploy;
`/version` must include `chatgpt-subscription`. Before using ChatGPT for unattended scoring, run the live
score eval cases on the chosen model; this change adds the option but does not silently change the default.
