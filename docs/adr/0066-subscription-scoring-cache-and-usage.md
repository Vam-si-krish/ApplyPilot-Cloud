# 0066 — Real prompt caching + token/cost visibility for subscription scoring

## Context

Scoring was switched to **subscription mode** (`score_provider=subscription`, `score_model=haiku`,
no API key — the Agent SDK on the worker). Two scoring-only problems surfaced (a caching audit like
ADR 0064's, but for the scorer):

1. **Caching never engaged.** `buildScoreMessages` (ADR 0056) carried the résumé cache breakpoint in the
   *user* message. The worker's `agentClient.toPromptAndSystem` folds every **system** role into the
   auto-cached `systemPrompt` but **flattens user parts**, silently dropping a user-side breakpoint — so
   only `SCORE_PROMPT` was cacheable. Worse, the whole prefix was **below Haiku 4.5's 4,096-token minimum
   cacheable prefix**: measured with `count_tokens`, `SCORE_PROMPT` = 2,330 tok + rendered résumé
   = 1,167 tok ≈ **3,500 < 4,096**, so even the direct-API path's `cache_control` was a no-op. Every job
   re-billed the full prefix against the 5-hour subscription window.
2. **No cost visibility.** ADR 0064 gave *tailoring* a per-résumé token/cost readout; scoring had none.

## Decision

Three scoring-only changes. **Tailoring is untouched** — its prompt, `buildTailorMessages`,
`tailor_usage`, and UI are read only as a reference; the shared `WorkerLLMClient` gains an *additive*
`lastUsage` field tailoring ignores.

1. **Résumé → cached second `system` message** (the ADR-0064 *technique*, copied into the scorer).
   `buildScoreMessages` now emits `system(SCORE_PROMPT)`, `system([{ résumé, cache:true }])`,
   `user([{ job }])` — in **both** `lib/scoring.ts` (direct-API + `/llm` paths) and
   `resume-worker/scoring.js` (`/score-jobs`). Subscription folds both system roles into the cached
   `systemPrompt`; direct-API Anthropic maps the `cache:true` system part → `cache_control`; compat
   providers flatten system parts in order (byte-stable prefix). Only the job posting is volatile.

2. **Enrich the cached block to clear 4,096.** `getScoringResumeText` (app `lib/db.ts` +
   worker `resume-worker/supabase.js`) now returns the rendered résumé **plus the structured
   `base_resume` JSON** (`composeScoringResume`). Both are per-candidate constants → fully cached, and
   the added bulk lifts the prefix to a measured **5,129 tokens** (+1,033 over Haiku's minimum). The JSON
   also gives the scorer authoritative structured grounding (exact dates, every bullet, education).
   **Evals are unaffected** — they call `scoreJob` with their own résumé string, not
   `getScoringResumeText`; all six live cases stayed in band.

3. **Capture + persist + surface usage.** The worker's `agentClient` already captures Agent-SDK usage
   (tokens in/out, cache read/write, `cost_usd` — ADR 0064). `/llm` now returns `{ text, usage }`;
   `/score-jobs` scores **sequentially** (subscription is window-throttled anyway, and one-at-a-time lets
   `client.lastUsage` attribute cleanly — a shared client under `Promise.all` would race) and writes
   `score_usage` alongside the fit fields. App-side: `WorkerLLMClient.lastUsage` reads the `/llm` usage;
   `chatAnthropic` sets `lastUsage` from `data.usage` (direct-API bonus); `scoreJob` attaches it to
   `ScoreResult.usage`; `scoreJobRows` writes it. New `jobs.score_usage jsonb` column (migration 0041,
   `ScoreUsage` type). The Jobs detail pane shows `Scored: X in (+Y cached) · Z out · $ · s · model`.

## Consequences

- Caching now works on Haiku in subscription mode (prefix 5,129 ≥ 4,096). The per-score readout is the
  built-in verification: on the **second+** job of a run, `cache_read_input_tokens` > 0 (`(+… cached)`);
  a persistent `0 cached` means the prefix slipped back under 4,096.
- Scoring now sees the candidate's full structured profile — a quality upgrade, not just padding.
- ⚠ **Worker Mac redeploy required** — `resume-worker/scoring.js`, `supabase.js`, `server.js` changed;
  verify with `curl <worker>/version`. Migration 0041 already applied live. Until redeploy, the
  `/score-jobs` path keeps the old behavior (no cache, no `score_usage`).
- The `/score-jobs` worker path still lacks the ADR-0065 company-tier/tech-stack fields (its `scoring.js`
  is a stale port) — a separate, pre-existing gap, not addressed here.
- Direct-API Anthropic scoring also gets a usage readout for free (the `chatAnthropic` capture), though
  its prefix only caches when it clears the model's minimum.
