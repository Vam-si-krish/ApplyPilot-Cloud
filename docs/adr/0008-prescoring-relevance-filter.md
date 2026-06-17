# ADR 0008 — Pre-scoring relevance filter + manual scoring re-trigger
**Status:** accepted · **Date:** 2026-06-17 · **Builds on:** ADR 0004 (decoupled fetch/score)
## Context
Every ingested job gets one LLM scoring call. A run can surface hundreds of jobs, so the auto-scorer
burns tokens on obviously-irrelevant postings. Separately, the self-retriggering scoring loop (ADR
0004) can stall if an invocation drops, leaving jobs `unscored` with no UI way to resume.
## Decision — cheap local gate before the LLM
Add a no-API relevance score and a threshold. The metric is **IDF-weighted coverage of the job's
terms by the résumé** (`lib/prefilter.ts`): of the job description's meaningful vocabulary (weighted
by inverse document frequency, so boilerplate counts for little), what fraction also appears in the
résumé. Chosen over TF-IDF cosine (values run low / hard to map to a "% match"), BM25 (ranking, not a
normalized score), plain Jaccard (ignores term importance), and embeddings (needs an API — defeats
the purpose). Coverage matches the user's mental model ("what % of this job am I a match for") and
calibrates naturally to a percentage threshold.

- **Computed at ingestion** (`/api/apify-webhook`), once per batch, and stored on every job as
  `prefilter_score` (0–100) — even when the filter is off, so the number is always visible for tuning.
- **Gated at scoring** (`/api/score-batch`): when `settings.prefilter_enabled`, jobs with
  `prefilter_score < settings.prefilter_threshold` are set to a new `status='filtered'` and skip the
  LLM. A null score (legacy rows / empty résumé) always passes. Filtered jobs leave the `unscored`
  queue, so the loop still drains.
- New `'filtered'` job status (migration 0006); excluded from the default Jobs/stats views, visible
  under a **Filtered** tab.
## Decision — manual re-trigger
New `POST /api/score-start` (session-gated) calls the existing `triggerScoreBatch()`; the Jobs page
shows a **"Score unscored (N)"** button. This resumes a stalled queue without touching score-batch's
CRON_SECRET auth.
## Why compute at ingestion but gate at scoring
Computing once at ingestion keeps it cheap and lets the user see the % before deciding a threshold;
gating at scoring means toggling the filter / changing the threshold takes effect on the next scoring
pass without re-fetching. IDF is built per ingestion batch — good enough to downweight boilerplate;
batch-relative variation is acceptable for a coarse gate.
## Notes
Threshold default 30%, configurable in Settings. The pre-filter is a coarse cost-saver, not a
replacement for the LLM rubric (ADR/CLAUDE invariant): it only decides *whether* to score, never
fabricates a fit_score.
