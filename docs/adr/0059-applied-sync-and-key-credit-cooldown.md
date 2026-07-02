# 0059 — Two-way applied sync + Apify key credit cooldown

## Context

Two user reports:

1. **"There is no Applied button in the Jobs section"** — the only per-row way to mark a job
   applied was the did-you-apply popup after opening a posting. Worse, the Tailor & Apply
   "Mark as applied" button only stamped `applications.applied_at`, while the Jobs tab, stats,
   and the ADR-0057 apply-once-per-requisition guard all read `jobs.applied_at` — the two
   tables could disagree.
2. **Mid-scrape credit death** — rotation could land on an Apify key whose remaining monthly
   credit was too low to finish a fetch: the run starts, bills the partial crawl, then dies.
   The user asked to park low keys "until the date the balance refreshes", with the threshold
   derived from the fetch size.

## Decision

**Applied marking + sync**
- Jobs tab: the passive Applied badge is now a per-row toggle (mark / confirm-unmark), next to
  Shortlist. Tailor & Apply: the applied badge is likewise a toggle.
- `PATCH /api/jobs/[id]` with `applied_at` also updates every application row for that job
  (status → 'applied' on mark; on unmark, an 'applied' row steps back to 'ready' when a
  tailored résumé exists, else 'queued').
- `PATCH /api/applications/[id]` that touches applied state also stamps/clears the linked
  job's `applied_at`. Both directions keep stats and the dedup guard truthful.

**Key credit cooldown (extends ADR 0058's `ensureApifyKeyWithCredit`)**
- `api_keys.cooldown_until timestamptz` (migration 0038). When the pre-run probe finds a key's
  headroom below the run estimate, the key is parked until its own `monthlyUsageCycle.endAt`
  from the Apify limits API (fallback now+24h, so a missing date can never park forever).
- Both the round-robin rotation (ADR 0007) and the credit probe skip parked keys without
  spending an API call; a key that passes the probe gets any stale park cleared.
- Threshold = `estimateRunCostUsd(settings)`: Σ per-portal caps × FREE-tier per-job price
  (linkedin $0.0007, indeed/glassdoor $0.003, career_sites $0.012) × 1.3 platform overhead,
  floored at **$0.75** — sized so the user's 800-cap LinkedIn fetch (≈$0.73 worst case) always
  completes; near the "~70 cents" figure the user suggested, but derived from the caps.
- Settings → API Keys shows a "⏸ low credit · resets <date>" badge on parked keys.

## Consequences

- Marking applied anywhere now means applied everywhere; unmarking is explicit (confirm) and
  reversible. Historic rows where the two tables already disagree are NOT backfilled.
- A run either starts on a key that can afford all enabled portals or fails loudly (402) —
  no more partial scrapes on dry accounts. Enabling career_sites raises the required headroom
  (≈$2.70 at cap 150), which is intended: it protects the more expensive run.
- Manually "Set active" on a parked key does not clear the park; the run-time probe re-decides.
