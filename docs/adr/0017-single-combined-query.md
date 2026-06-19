# ADR 0017 — One combined, de-duplicated LinkedIn query (supersedes ADR 0015)

**Status:** accepted · **Date:** 2026-06-18 · **Supersedes** [ADR 0015](0015-per-location-limits.md)

## Context
ADR 0015 fanned LinkedIn out into **one Apify run per location** to allow a different per-role cap per
location. Two problems surfaced once the user moved to the pay-per-result `cheap_scraper` actor:
1. **Duplicate charges.** Separate runs can't see each other, so a job matching two locations (a Boston
   job appears under both "Boston, MA" and "United States") is returned — and billed — in *each* run.
2. **The per-location cap was largely moot.** Pay-per-result means you only pay for jobs that actually
   exist; a small market just returns fewer. And the actor enforces `maxItems ≥ 150`, so caps below 150
   can't be honored anyway.

The user asked for it to run as **one query** covering all locations ("location in United States OR
Boston"), not multiple. The actor's input schema supports this: `locations` is an array, plus
`saveOnlyUniqueItems` for de-duplication.

## Decision
Run LinkedIn as **one combined query** over all selected roles × locations.

- `planRuns` emits **one run per portal** again (no per-location fan-out).
- `buildLinkedInInput` puts all locations in the actor's `locations` array and one `startUrls` entry per
  role × location, and sets **`saveOnlyUniqueItems: true`** — the actor de-duplicates, so an overlapping
  job is fetched and **billed once**.
- `maxItems` is a single run-wide cap = `results_per_query × #combos`, floored to `MIN_MAX_ITEMS` (150).
- **UI:** the per-location "jobs per role" inputs are removed; one "Results per role" field remains, with
  a note that everything runs as a single de-duplicated search.

## Consequences
- No double-billing across overlapping locations; cleaner and slightly cheaper.
- **Per-location caps are gone** — there is one shared cap. Acceptable: with pay-per-result + the 150
  floor + natural scarcity in small markets, separate caps bought almost nothing.
- `settings.location_limits` (migration 0012) and `perLocationLimit` are now unused. The column is left
  in place (harmless, no migration needed); `perLocationLimit`/the per-location input builder were
  removed. If per-location caps are ever wanted again, prefer the standard (bebity) actor and reintroduce
  the fan-out behind a toggle.

## Alternatives considered
- **Keep per-location fan-out** — rejected: causes duplicate charges and conflicts with the explicit
  "one query" request; the caps weren't earning their keep.
- **One run but per-location `maxItems`** — impossible: the actor takes a single global `maxItems`.
