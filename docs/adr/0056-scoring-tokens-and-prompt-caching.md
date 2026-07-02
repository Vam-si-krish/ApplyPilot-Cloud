# ADR 0056 — Scoring token hygiene + prompt-caching audit

**Status:** accepted · **Date:** 2026-07-02 · **Touches:** scoring INPUT preprocessing only — `SCORE_PROMPT`, the rubric, and parsing are unchanged (CLAUDE.md invariant holds; evals green)

## Context
A prompt-caching/token audit across all LLM call paths found the high-volume lane — fit scoring,
one call per job, hundreds per day — was the only one both uncached and token-wasteful:
- **Scored raw HTML.** `full_description` is stored as scraped HTML (the UI renders it). Tags and
  entities burned roughly 20–40% of the job-description tokens on every call, and the 15000-char
  truncation cut on HTML, so tag-heavy postings lost real content off the end.
- **No cache breakpoints.** The system prompt (~1.4K tokens) + résumé (~1.5–2K tokens) are identical
  for every job in a run, but Anthropic-keyed scoring re-billed them at full price per job
  (Anthropic caching is explicit `cache_control`; only tailoring used it, correctly, since ADR 0031).
- **Concurrency defeated first-wave caching.** A cache entry becomes readable only after the first
  response starts streaming; `scoreJobRows` fired 8 concurrent calls at once, so the first wave all
  missed.
Everything else audited clean: tailoring's stable-prefix + cached base block is correct in both
copies (breakpoint on the base block covers system+base as a prefix); company check (~350-token
prompt) and mail classification are below every model's minimum cacheable prefix (1024–4096 tokens
by model); the assistant is low-volume interactive; the Agent-SDK subscription path flattens
content parts to the identical string (caching there is the SDK's concern).

## Decision
1. **Strip HTML before truncation** in `buildScoreMessages` (app `lib/scoring.ts` + worker port
   `resume-worker/scoring.js`, kept in sync): `stripHtml` (the ADR 0053 helper; ported locally on
   the worker) runs before the 15000-char cut. Input preprocessing only — same rubric, same output
   contract; eval cases are plain text and unaffected.
2. **Cache breakpoint on the résumé segment**: the scoring user message is now
   `[{résumé prefix, cache:true}, {job posting}]`. On Anthropic, system+résumé bill at ~0.1× from
   the second job of a run (5-min TTL, refreshed by each hit — a chunked run keeps it warm).
   Providers without `cache_control` flatten the parts with `\n\n` back to the byte-identical old
   string, preserving OpenAI/DeepSeek/Gemini implicit prefix caching. Minimum-prefix caveat: on
   Opus-class models (4096-token floor) the ~3.5K prefix may silently not cache — harmless no-op.
3. **Warm-first scoring pool** (`scoreJobRows`): the first row is scored alone to write the cache,
   then the bounded pool (8) drains the rest reading it.

## Consequences
- Scoring inputs shrink ~20–40% on typical LinkedIn postings and stop losing tail content to tag
  overhead; on Anthropic keys the per-job cost of the repeated prefix drops ~10×.
- The Worker Mac needs `git pull` + restart for the subscription-scoring port to match.
- Any future prompt-assembly change must keep the résumé segment free of per-job content (that
  would poison the cached prefix) — tested in `scoring.test.ts`.
