# 0071 — Duplicates only within a single day (group by date + company + title)

## Context

ADR 0057 (addendum) made the duplicate fingerprint deliberately aggressive: `content_key` =
md5(company + title), no body, no date — because multi-location blasts vary the body per city, and
a body-inclusive hash missed most of them. `linkDuplicateJobs` then grouped **every row in the DB**
sharing a key, with no age limit.

The unbounded time range turned out to be the problem: when a company re-opens the same title months
later (a genuinely new requisition), the fresh posting was linked as `duplicate_of` a stale
canonical, inherited a months-old score, and never surfaced as new. The user hit this in practice
("old jobs and new jobs merge together if they share the same title").

Options considered, in order:

- **Fetch date inside the key hash** (user's first idea) — implemented equivalently at the linking
  layer instead (same grouping semantics), so stored keys stay pure content fingerprints, remain
  comparable across runs, and no backfill is needed.
- **Recency window (e.g. 45 days) on linking** — proposed, declined by the user as too broad.
- **Same-day + cross-day-body-match** — built briefly during the session, then simplified away on
  the user's instruction ("don't worry about description; just add date").
- **Duplicates only within a single day** (user decision) — accepted, this ADR.

## Decision

`content_key` is **unchanged**. The change is in *linking*: `partitionByGeneration`
([lib/dedupe.ts](../../lib/dedupe.ts)) splits each content-key group by the **UTC date of
`discovered_at`**, so the effective duplicate group is **(company, title, day)**.
`linkDuplicateJobs` ([lib/db.ts](../../lib/db.ts)) applies the existing canonical/link/score-copy
logic per day-group.

- A same-day multi-location blast (one requisition × N metros in one scrape) still collapses to one
  canonical with score copies — the case 0057 was built for.
- A repost on ANY later day is a fresh posting: scored fresh, surfaces as new. Old and re-opened
  openings can never merge.

## Consequences

- **Cross-day reposts are re-scored.** An employer re-blasting the same requisition daily now costs
  one scoring call per day (previously a free score copy). This is the explicit, accepted trade-off:
  the user prefers fresh visibility over cross-day call savings. Same-day blasts — the bulk of the
  measured 32% duplicate volume — still dedupe for free.
- Existing `duplicate_of` links created under 0057's unbounded rule are left untouched (no
  re-parenting, no unlink backfill) — the new behaviour applies from the next ingest onward.
- Rows of one ingest share a timestamp, so the UTC day split cannot break up a single run's batch
  unless the run itself straddles UTC midnight (not the case for the fixed daily schedule).
- Unit tests in [lib/dedupe.test.ts](../../lib/dedupe.test.ts) pin the same-day blast, the next-day
  split, and the months-apart split.
