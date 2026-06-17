# ADR 0004 — Decouple fetch and score (async Apify + chunked scoring)
**Status:** accepted · **Date:** 2026-06-17
## Context
Vercel serverless functions are short-lived (~10–60s). A daily run may fetch dozens of jobs
and score each with an LLM call (rate-limited to ~15 RPM on Gemini free tier). Doing
fetch + score in one request would always exceed the timeout.
## Decision
Three decoupled endpoints:
1. `/api/run` starts the Apify actor **async** (returns runId instantly) and registers a
   webhook; never blocks on the scrape.
2. `/api/apify-webhook` ingests the finished dataset into Supabase as `unscored`, then
   triggers scoring.
3. `/api/score-batch` scores at most `SCORE_BATCH_SIZE` jobs per invocation and re-triggers
   itself (fire-and-forget fetch with `CRON_SECRET`) until no `unscored` jobs remain.
## Alternatives considered
- **Single synchronous run** — rejected: guaranteed timeout at any real volume.
- **External queue (SQS/Upstash/Supabase queue)** — deferred: more infra than needed for a
  single user; the self-retrigger loop is dependency-free. Revisit if the loop proves fragile.
- **Long-running worker/VM** — rejected: defeats the serverless goal of the rewrite.
