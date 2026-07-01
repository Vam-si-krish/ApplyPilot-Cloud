# ADR 0049 — Real progress for delegated subscription batches (scoring + assessment)

**Status:** accepted · **Date:** 2026-07-01 · extends [ADR 0042](0042-ai-on-claude-subscription-via-agent-sdk.md), [ADR 0009](0009-ai-company-assessment.md)

## Context
When the scoring provider is `subscription` (ADR 0042), a per-job LLM call is an Agent-SDK
subprocess on the worker. Two Jobs-tab bulk actions were affected:

1. **Score selected** already delegated to the worker's `/score-jobs` (which acks instantly and
   scores in the background) — but the client toast treated the instant ack as completion. It
   flashed for ~1s, showed "done", and auto-dismissed while the worker was still scoring. The
   scores appeared later (or looked like they didn't), and a real failure was invisible.
2. **Assess / re-assess companies** (`/api/company-check`) ran up to 10 subprocess `/llm` calls
   **inside** the ~60s serverless function — the exact pattern score-selected was moved off of —
   risking a timeout on a slow/cold worker.

## Decision
Make delegated batches report **real** progress, polled from the database, and move company
assessment onto the same background-delegation model as scoring.

- **`/api/score-selected`** returns `delegated: true` in subscription mode so the client knows
  the response is a hand-off, not completion.
- **New worker `POST /assess-jobs`** — the assessment sibling of `/score-jobs`: acks immediately,
  assesses in the background (one call/job, writing `company_tier`/`company_tier_note`), using the
  scoring provider. Requires a new worker file `resume-worker/companyCheck.js` (a faithful port of
  `lib/companyCheck.ts`: same `COMPANY_PROMPT`, parser, and "unknown on error, never fabricated").
- **`/api/company-check`** delegates to `/assess-jobs` in subscription mode (returns
  `delegated: true`); API-key providers stay synchronous. Before handing off, it **nulls
  `company_tier`** for the selected ids so a re-assessment has a clean pending→terminal transition
  the poll can detect (mirrors how deleting a fit score resets a job to `unscored`, ADR 0048).
- **New `POST /api/score-progress`** `{ ids, mode: 'score' | 'assess' }` → `{ scored, total }`: a
  lightweight count of how many selected ids have reached a terminal state (`score`: left the
  `unscored` status; `assess`: `company_tier` set). No LLM, no writes.
- **`scoreSelected` / `assessSelected`** (Jobs tab): when the response is `delegated`, poll
  `/api/score-progress` every 2s and drive the toast off the true count, filling one-by-one as the
  worker writes results, finishing only when all ids are terminal. A 5-minute ceiling resolves the
  toast ("Scored N/M — still working in the background") if the worker stalls, so it can't hang.

Because both worker endpoints write a terminal result even on an LLM error (score 0 / tier
'unknown'), the poll always completes; only a full worker crash hits the timeout.

## Consequences
- The progress toast now reflects real subscription work instead of the instant ack.
- Company assessment no longer risks a serverless timeout in subscription mode.
- **Worker redeploy required** for `/assess-jobs` (and the `companyCheck.js` port) to exist; until
  then, subscription assessment will 404 at the worker and surface a clean error rather than
  silently mis-reporting. `/version` now lists `assess-jobs` in `features` to confirm the deploy.
- Other async flows were audited and already correct: the Tailor & Apply generate/queue flows and
  the Inbox sync already poll to completion.
