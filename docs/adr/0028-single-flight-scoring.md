# ADR 0028 — Single-flight scoring with live progress + stop

## Status
Accepted (2026-06-23)

## Context
Fit scoring is server-driven and self-triggering: `triggerScoreBatch()` →
`/api/score-batch` scores `SCORE_BATCH_SIZE` jobs, then fire-and-forgets a POST to
itself until the `unscored` queue drains (ADR 0004). Two problems surfaced at ~700
jobs/day:

1. **Jobs could be scored more than once.** `getUnscoredBatch` reads
   `status='unscored' ORDER BY discovered_at LIMIT 5` and the row stays `unscored`
   across the slow LLM call — there is **no claim**. Any two scoring chains running
   at once read the *same* oldest rows and both call the LLM. Concurrent chains were
   easy to start: one Apify webhook per enabled portal, the manual "Score unscored"
   button (`/api/score-start`), a "Run now" overlapping a still-draining run, and
   `score-selected`. The final DB write is idempotent (both set `scored`), so the
   *data* looked fine — hiding wasted/duplicated LLM calls and double-counted run
   stats.
2. **No visibility or control.** The loop ran invisibly server-side. The only signal
   was a slowly-shrinking "unscored" count (the constant `/api/stats` poll in the
   app shell). There was no progress bar, no "it stopped" state, and no way to stop
   mid-run.

## Decision
Introduce a **single-flight scoring session**: one row `scoring_state` (id=1) that is
both a mutex and the live progress, plus a Gmail-style progress panel.

- **Atomic mutex (CAS).** A START (`/api/score-batch` with no `?token`) acquires the
  lock via a single-row conditional `UPDATE … WHERE id=1 AND (active=false OR
  heartbeat < now()-120s)`. Under READ COMMITTED this is an atomic compare-and-swap —
  exactly one of N concurrent callers wins; the rest no-op. **This is what stops
  duplicate scoring.** A stale heartbeat (crashed function) auto-releases so the loop
  can resume.
- **Token-scoped continuation.** The winner gets a random `token`; each self-trigger
  carries it (`?token=`). A CONTINUE validates the token, refreshes the heartbeat,
  and proceeds — so only the owning chain drives the loop.
- **Stop without losing work.** `/api/score-stop` sets `stop_requested`; the chain
  checks it at the next batch's entry and halts (≤1 batch latency). Scored rows stay
  scored; the rest stay `unscored` and resume on the next START.
- **Progress.** `total` (snapshot at acquire) and `done` (bumped per batch) drive a
  `done/total` progress bar via `/api/score-status`. The panel polls fast (2.5s)
  while active, slow (12s) while idle, and shows Start / Stop / "Done".
- **No orphaned rows (common case).** Per-batch `countUnscored()` re-checks the queue,
  so rows inserted by a later portal webhook while a chain is active are picked up
  automatically. For the narrow window where rows arrive exactly as a chain drains, a
  rejected START sets `rescan_requested`, which the draining chain consumes and
  re-scans.

## Consequences
- Each job is LLM-scored once per pass; duplicate chains can't form.
- The daily unattended run still works (still server-driven); the panel just observes
  and can stop it.
- New surface: `scoring_state` table (migration 0023), `/api/score-status`,
  `/api/score-stop`, `ScoringPanel` (Dashboard + Jobs), `triggerScoreBatch(token?)`,
  and lock/progress helpers in `lib/db.ts`. `/api/score-start` and the webhook are
  unchanged callers (they START, and now no-op when a chain is already running).
- **Residual edge (accepted):** a rows-arrive-exactly-at-final-drain micro-race can
  leave a straggler `unscored`; the manual "Score now" button and the daily cron
  re-drive catch it. Not worth more locking for a single-user app.
- `score-selected` (manual hand-picked ids) still bypasses the lock by design (a
  bounded, deliberate action). Overlap with the auto-loop on the same row is possible
  but low-impact; left as-is.
