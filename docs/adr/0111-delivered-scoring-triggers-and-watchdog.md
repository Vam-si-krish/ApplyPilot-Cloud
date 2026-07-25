# ADR 0111: Delivered scoring triggers, score-tick watchdog, and idle-run finalization

- Status: accepted
- Date: 2026-07-25
- Amends: [ADR 0004](0004-decouple-fetch-and-score.md) (chunked re-trigger), [ADR 0028](0028-single-flight-scoring.md) (stale-lock takeover)

## Context

Nearly every recent production run sat in `status='running'` forever with
`jobs_scored` frozen at a multiple of `SCORE_BATCH_SIZE` (0, 5, 15, 40 …) while
unscored jobs piled up. The chain relied on a fire-and-forget `void fetch()` to
re-invoke `/api/score-batch`: on serverless the instance freezes the moment the
response returns, so the un-awaited request was frequently never sent. The dropped
link killed the chain silently; the 120 s stale-lock takeover existed but nothing ever
fired a new START (the next opportunity was the following day's webhook or a manual
button). `finishUp` also finalized only the LATEST 'running' run, so interrupted older
runs could never leave 'running', and the webhook's zero-insert path finalized
whichever run happened to be latest rather than its own.

## Decision

- **Delivered triggers:** `triggerScoreBatch` is now awaited by every caller. It waits
  only for request *delivery* (a 3 s abort window — never for the downstream batch), so
  the chain does not serialize but the request reliably leaves the process before the
  instance freezes.
- **Watchdog:** a new self-authorized `/api/score-tick` walks all configured users:
  unscored jobs + no live chain (lock free or heartbeat stale) → START a chain (the
  ADR 0028 takeover makes this race-safe); queue empty → finalize idle runs. A Netlify
  scheduled function (`score-tick.mjs`, every 5 minutes) drives it; a healthy pipeline
  makes each tick one COUNT query per user.
- **Idle-run finalization:** `finalizeIdleRuns` closes every 'running' run once the
  user's unscored queue is empty, except runs younger than 10 minutes with
  `jobs_found = 0`, whose scrape/webhook may still be in flight. The webhook's
  zero-insert path finalizes its own (owning) run explicitly.

## Consequences

- A dropped trigger now costs at most one tick interval instead of stranding the queue
  for a day; runs converge to a terminal status without manual intervention.
- The stuck production backlog drains automatically once this deploys: the first ticks
  start chains for every user with unscored jobs and sweep stale 'running' rows.
- The delivery-window abort is best-effort by design; correctness rests on the tick, so
  the schedule must stay enabled (it is the pipeline's only external re-driver on
  serverless).
