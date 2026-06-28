# ADR 0042 — Run AI on the Claude subscription via the Agent SDK (on the worker)

## Status
Accepted (2026-06-28)

## Context
Every AI task funnels through one interface — `LLMClient.chat(messages, opts)` ([lib/llm.ts](../../lib/llm.ts)) —
built per task by `buildClientForTask(settings, 'score'|'tailor')` ([lib/scoreRunner.ts](../../lib/scoreRunner.ts)),
which resolves a **paid third-party API key** from the vault (Gemini / OpenAI / DeepSeek / Anthropic, ADR 0006/0025).
The two lanes partition all work: **score** = job scoring, company assessment, mail classify, assistant; **tailor**
= résumé parse, tailoring, cover letters.

The user already pays for a Claude Pro/Max subscription and wants the option to run this AI on that plan instead of
funding a separate API key. The **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`) can do this: it drives the
`claude` CLI, which — when the machine is authenticated to a subscription (via `claude setup-token` →
`CLAUDE_CODE_OAUTH_TOKEN`, or `claude login`) and **no `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` is in its
environment** — bills the subscription, not the API. The SDK can only run on a real always-on machine; it **cannot**
run in a Netlify/Vercel serverless function. We already have exactly such a machine: the always-on Mac
**`resume-worker`** (ADR 0027/0032), reached over the Cloudflare Tunnel with a shared Bearer secret, which already
runs the heavy tailoring LLM calls and PDF rendering.

**Billing reality (changed 2026-06-15):** Agent-SDK / headless `claude -p` usage no longer draws from the
interactive chat quota. Each plan gets a **separate monthly Agent-SDK credit pool** (Pro $20 / Max5× $100 /
Max20× $200), then **standard API rates** beyond it. So this is "spend the included monthly SDK credit instead of a
separate API account" — real savings up to the cap, **not unlimited**. This is why the switch is **per-task**.

## Decision
Add a pseudo-provider value **`'subscription'`**, selectable **per lane** in the existing Scoring-model and
Tailoring-model selectors. Setting both = "use my plan for everything"; mixing keeps cheap high-volume scoring on a
real API while tailoring runs on the plan. No new settings columns — it reuses `score_provider`/`score_model` and
`tailor_provider`/`tailor_model` (the `*_model` holds an Agent-SDK alias: `sonnet` | `opus` | `haiku`).

- **Worker is the LLM backend.** New `resume-worker/agentClient.js` exposes `makeAgentClient(model)` with the same
  `.chat(messages, opts)` contract as the existing client. It maps messages → SDK `query({ prompt, options })` with a
  custom string `systemPrompt`, `maxTurns: 1`, `allowedTools: []`, `settingSources: []`, and an `env` that **strips
  `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN`** so it can never silently bill the API.
  - New `POST /llm { messages, model, temperature, maxTokens } → { text }` on the worker serves the cloud's
    **serverless** lanes over the tunnel.
  - Worker-**local** tasks (`/tailor`, `/cover-letter`, `/generate` condense) build `makeAgentClient` directly when
    the provider is `subscription` (no HTTP hop), via a shared `resolveTaskClient(provider, model)` helper.
- **Cloud app routes the lane to the worker.** New `WorkerLLMClient` (extends `LLMClient`, overrides `chat`) POSTs to
  `<worker>/llm` with the Bearer secret. `buildClientForTask` special-cases `provider === 'subscription'` and returns
  it; if the worker isn't configured it **throws a clear error** rather than falling back to a paid env key (for
  scoring this surfaces as a visible score-0 with an explanatory reasoning string — never a fabricated score).

## Consequences
- **Scoring discipline preserved (CLAUDE.md):** still exactly one model call per job (`maxTurns: 1`); the same
  defensive parser clamps 0–10; a parse failure or SDK error still yields a visible score `0`, never fabricated.
- **Capped, not free:** above the monthly Agent-SDK credit it bills at standard API rates. The Settings helper and
  SETUP.md say so, and recommend keeping high-volume scoring on a cheap API model with the subscription on tailoring.
- **No temperature/max_tokens control:** the SDK/CLI doesn't expose them, so subscription-routed calls run at the
  model's defaults (scoring otherwise uses 0.1). Acceptable; the rubric + defensive parsing absorb the difference.
- **New dependency on the worker for serverless AI:** when a lane is on `subscription`, that lane needs the worker
  online (PDF/tailoring already did). A clear error is surfaced when it's down or unauthenticated.
- **Auth-precedence footgun documented:** the worker must not carry `ANTHROPIC_API_KEY` in its process env, or the
  subscription is bypassed. The agent client also strips it from the SDK subprocess env as defense-in-depth. The
  worker still uses Anthropic *vault* keys for API-mode tailoring — those are passed to the API directly, not via env.
- **Latency:** each `/llm` call spawns a `claude` subprocess (~seconds). Fine at the existing `SCORE_CONCURRENCY`
  for daily volumes; a warm process/session pool is a deferred optimization.
