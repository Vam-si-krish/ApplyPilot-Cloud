# ADR 0013 — Two-phase Gmail sync (fetch → classify) with live progress

**Status:** accepted · **Date:** 2026-06-18 · **Supersedes the sync half of** [ADR 0012](0012-gmail-inbox.md)

## Context
The original sync (ADR 0012) did everything in one capped pass per invocation: list ≤50 ids,
fetch + AI-classify the first 15 fresh ones, then **advance `last_synced_at` to `now()`**. That
silently stranded backlog: if the look-back window held more than 15 new emails, the leftovers fell
behind the moved cursor and were **never** processed. The user also had no visibility — "Sync now"
was an opaque spinner with a single summary line at the end.

Requirements: (1) **no mail left behind** — process every email in the window without skipping or
timing out; (2) **real-time UI** — show total found, live classify progress ("X of N"), and a clear
finish; (3) first connect must pull **all** of the last 3 days, then only fetch new mail thereafter.

## Decision
Split sync into two idempotent, chunked phases and let the cursor advance only when fetch is complete.

- **Schema (migration 0011):** `mail_messages.category` becomes nullable; add
  `status text in ('pending','classified')` default `'pending'`. A row is stored first as `pending`
  (headers + snippet, no category) and flipped to `classified` once the AI labels it. Existing rows
  are backfilled to `classified`.
- **Engine (`lib/mailSync.ts`):**
  - `fetchChunk` — paginates the **whole** window (`listAllMessageIds`, cap 500), de-dupes by
    `gmail_id`, and stores up to `MAIL_FETCH_BATCH` (25) new messages as `pending`. **`last_synced_at`
    advances only when no fresh ids remain**, so a per-run cap can never strand backlog.
  - `classifyChunk` — labels up to `MAIL_CLASSIFY_BATCH` (8) pending messages, one **separate** LLM
    call each (frozen SCORE_PROMPT untouched), and flips them to `classified`.
- **Routes:** `POST/GET /api/gmail/fetch` and `/api/gmail/classify-batch` run one chunk and return
  progress counts. `/api/gmail/sync` becomes a **headless orchestrator** (cron, every 30 min): it
  loops fetch-then-classify within one invocation under a ~50s budget; whatever doesn't finish is
  resumed by the next tick (fetch from remaining fresh ids, classify from `status='pending'`).
- **Live UI:** the Inbox "Sync now" button **drives the loop client-side** — calls `/api/gmail/fetch`
  until `done` ("N found", new mail appears immediately as **Pending**), then
  `/api/gmail/classify-batch` until the pending queue drains, rendering a progress bar
  ("X of N classified") and a final "Done". `GET /api/mail` now also returns a `pending` count.

## Why client-driven for the UI (not SSE / not the cron)
Serverless functions can't hold an SSE stream open across the whole job within the timeout, and the
self-retriggering fan-out pattern (ADR 0004) is headless — its progress isn't observable from the
browser. A client-driven chunk loop is the simplest way to get deterministic, real-time progress:
each chunk response *is* a progress tick, work stays in small sub-timeout calls, and the page can
refresh the list live as categories fill in. The cron keeps the headless orchestrator so sync still
happens without anyone watching.

## Consequences
- No mail is skipped: the cursor tracks "fully fetched", classification tracks `pending` separately.
- Fetch (cheap metadata) is decoupled from classify (LLM), so emails show up instantly and get
  labeled afterward — matching "every mail there first, AI goes through them one by one."
- Both paths are idempotent (dedupe + status drain), so a manual sync and a cron tick overlapping is
  at worst slightly redundant, never incorrect.
- One-off on deploy: reset `last_synced_at = null` so the next fetch backfills the full 3-day window
  the buggy cursor had skipped past.

## Alternatives considered
- **Bigger per-run cap, same single pass** — still strands anything beyond the (now larger) cap and
  still advances the cursor past it. Rejected: doesn't fix the class of bug.
- **SSE / WebSocket progress** — rejected: awkward under serverless timeouts; polling-by-chunk gives
  the same UX with far less machinery.
- **Pub/Sub push (real-time)** — rejected again (per ADR 0012): more moving parts than a job inbox
  needs.
