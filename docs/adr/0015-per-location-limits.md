# ADR 0015 — Per-location fetch limits (LinkedIn fan-out)

**Status:** accepted · **Date:** 2026-06-18 · **Refines** [ADR 0005](0005-apify-integration.md)

## Context
Search used a single `results_per_query` applied to every keyword × location equally. With locations of
very different size — "United States" vs "Boston, MA" — one number fits neither: set it high and a small
market over-asks (harmless but pointless); set it low and the big market is starved. The user wants a
**separate jobs-per-role cap per location**.

## Decision
Add an optional per-location override and fan LinkedIn out into one Apify run per location.

- **Schema (migration 0012):** `settings.location_limits jsonb default '{}'` — a map
  `{ "<location>": <jobs per role> }`. A location absent from the map falls back to
  `results_per_query` (now surfaced in the UI as "Default jobs per role").
- **Run planning (`lib/apify.ts`):** new pure `planRuns(settings)` returns one `RunSpec` per actor run.
  For **LinkedIn** it emits **one run per location** (`buildLinkedInInputForLocation`), each with
  `rows = perLocationLimit(location)` and `maxItems = rows × #keywords`. The LinkedIn actor only accepts
  a single global count per run, so a per-location cap *must* be a per-run (= per-location) fan-out.
  Other portals keep their existing single cross-product run. `startAllPortalRuns` now just executes the
  plan, tagging each webhook with `?portal=`. Multiple runs/day is already supported by the pipeline
  (each run row is created and the scoring loop drains all unscored jobs).
- **UI:** Settings → Search Criteria lists each location with a "jobs per role" number (blank = default),
  and relabels the global field to "Default jobs per role".

## Scope
LinkedIn only, by request — the user uses only LinkedIn today. Indeed/Glassdoor still use a single run
with the first keyword/location (a pre-existing limitation, noted but unchanged here).

## Consequences
- Each location is its own run → its own dataset/webhook; counts are independent (Boston small, US large)
  without coupling through one shared `maxItems`.
- More Apify runs per day (one per location). Cost is not a concern for this user; the trade is precise
  control. `planRuns` is pure and unit-tested (`lib/apify.test.ts`).

## Alternatives considered
- **Per-URL counts in one run** — rejected: the LinkedIn actors expose only a single global `rows`/
  `maxItems`, so per-location differentiation isn't possible within one run.
- **Per-location AND per-keyword limits** — deferred: more knobs than asked for; jobs-per-role per
  location matches the user's mental model ("50 × 4 roles = 200 for this location").
