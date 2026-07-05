# ADR 0060 — A failed regeneration never clobbers a good résumé; usage-limit circuit breaker

## Status
Accepted (2026-07-05)

## Context
The user bulk-generated résumés for a ~37-row Tailor & Apply batch in subscription mode.
Both Claude accounts' windows exhausted near the end of the run ("You've hit your usage
limit"). Post-mortem from the DB: all 37 rows ended `status='failed'` with the same
`Agent SDK error … task=tailor` message written over 9 minutes — **33 of them still held a
perfectly good tailored résumé + PDF + cover letter** from earlier in the run. The UI showed
FAILED on everything, which reads as "the whole batch is lost" when in fact ~90% was done.

Three compounding defects:
1. **Failure writes were unconditional.** The worker's `/tailor` catch, the `/tailor-queue`
   drain catch, and the `/generate` (PDF render) catch all wrote `status='failed'` without
   checking whether the row already had a usable résumé. A failed *re*generation (or a
   render hiccup) demoted a finished row to FAILED while its assets sat intact.
2. **Bulk "Generate selected" re-tailored finished rows.** Select-all + Generate ran the
   pipeline over *every* selected row, including ones already `ready` — so once the quota
   died, the loop marched through the finished rows and (per defect 1) flipped each to
   FAILED. ("Score selected" already skips scored jobs; generate had no such guard.)
3. **No exhaustion breaker.** Out-of-quota errors fail in ~3s, so the loops rapid-fired the
   identical failure across the whole remaining batch instead of stopping.

## Decision
- **Status reflects what the user can use, not the last attempt.** New worker helper
  `markTailorFailure(id, msg)`: if the row still has `tailored_resume`, keep/restore
  `status='ready'` and store `error='Regenerate failed — kept the previous résumé. …'`;
  only rows with nothing to show become `failed`. The `/generate` render catch likewise
  restores `ready` (its precondition guarantees a résumé exists — only the PDF failed).
- **Bulk generate skips rows that already have a résumé** (app UI): the button count,
  the id filter, and the tooltip all exclude them; a toast reports how many were skipped.
  The per-row **Regenerate** button remains the deliberate, one-at-a-time redo path.
- **Usage-limit circuit breaker** in both batch loops: when a failure matches
  `isUsageLimitError` (hit-your-limit / usage limit / rate limit / quota / credit), the
  worker drain `break`s (remaining rows stay `queued` for the next window) and the client
  pool stops picking new ids, reporting "Stopped — Claude usage limit hit".

## Consequences
- A quota outage mid-batch now costs only the rows actually in flight; everything finished
  stays READY and everything untouched stays QUEUED — re-runnable when the window resets.
- Bulk regeneration of many rows is no longer possible in one click (by design — each redo
  costs a call and risks overwriting a good résumé with a worse one). Redo is per-row.
- The 37 damaged rows were repaired in place (33 → `ready`, 4 → `queued`).
- Worker changes require a deploy on the Worker Mac (`server.js`); app changes ship with
  the next Netlify deploy. Until the worker is redeployed, only the app-side guards apply.
