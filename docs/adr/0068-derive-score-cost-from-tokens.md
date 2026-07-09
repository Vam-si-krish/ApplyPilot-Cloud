# 0068 — Show actual USD cost per score, derived from tokens

## Context

ADR 0066 added a per-score usage readout in [components/JobDetails.tsx](../../components/JobDetails.tsx):

```
Scored: 1.2k in (+5.3k cached) · 779 out · 10.2s · claude-haiku-4-5-20251001
```

It was meant to show a `$` cost too — the JSX already renders `cost_usd` when it's a number
([JobDetails.tsx](../../components/JobDetails.tsx)). But in production scoring runs in **subscription
mode** on the Worker Mac via the Agent SDK, which draws from the plan's 5-hour usage window rather
than per-token billing — so the SDK reports `total_cost_usd` as **null**
([resume-worker/agentClient.js](../../resume-worker/agentClient.js)). `cost_usd` came through null, the
guard fell through, and the readout showed tokens + time + model but **no dollar figure**.

## Decision

Stop depending on the SDK's `cost_usd`. Derive the **actual API-equivalent cost** from the token
breakdown the call already reports, using each model's published per-million-token rates. New helper
`scoreUsageCostUsd` in [lib/pricing.ts](../../lib/pricing.ts):

- Rates table keyed by model-id substring. Scoring runs on **Haiku 4.5**: input **$1**/1M,
  output **$5**/1M, cache-read **$0.10**/1M (~0.1×), cache-write(5m) **$1.25**/1M (~1.25×).
- Anthropic's usage convention: `input_tokens` is the **uncached remainder** — cache reads and cache
  writes are billed separately at their own rates. So
  `cost = input×$1 + cache_read×$0.10 + cache_write×$1.25 + output×$5` (per 1M).
  The readout example prices to **$0.0056**.
- Prefers the derived figure (consistent with the tokens shown); falls back to the SDK's `cost_usd`
  only for an unknown model; returns null when it can price neither.

The UI shows it as a 4-decimal `$` (scores are sub-cent; a tiny non-zero cost floors to `<$0.0001`).

## Consequences

- **Backfills existing rows** — the cost is computed in the UI from stored token counts, so every
  already-scored job now shows a cost with **no re-score**.
- Unit tests in [lib/pricing.test.ts](../../lib/pricing.test.ts) pin the Haiku math, the cache-write
  rate, the derive-over-`cost_usd` preference, and the unknown-model fallback.
- The figure is **API-equivalent** cost, not what's billed against the subscription window (which is
  time/quota, not dollars) — the tooltip says so. If scoring ever moves to a paid API key, the same
  helper prices it, and `cost_usd` remains the fallback for any model not in the rates table.
- Rates are hard-coded; a model swap needs a rates entry (the table already carries Sonnet/Opus).
