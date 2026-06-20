# ADR 0023 — Fetch fix: URL-driven LinkedIn input + hard total cap

**Status:** accepted · **Date:** 2026-06-20 · **Amends** [ADR 0017](0017-single-combined-query.md)

## Context
After ADR 0017 the LinkedIn input sent the actor BOTH our explicit `startUrls` (one per role×location)
AND the actor's native `keyword[]` + `locations[]` arrays. The cheap_scraper actor docs: *"each location
is combined with every keyword to generate one search per pair"* — so it ran its own keyword×location
searches **in addition to** crawling our startUrls (double-fetch). Worse, the run cap was
`results_per_query × (#roles × #locations)`, which **balloons as the user adds locations** — a user who
expected ~500 got ~1200 once their location library grew. `maxItems` is a confirmed **global** cap, so
the count == that ballooning cap value.

## Decision
- **URL-driven only.** Send just `startUrls` (one per role×location, look-back window baked into the
  URL's `f_TPR`), plus `maxItems`, `saveOnlyUniqueItems`, `resumeKeywords`, `publishedAt`, `proxy`. Do
  **not** send `keyword`/`keywords`/`locations`/`location`/`urls`/`rows`/`maxResults` — those triggered
  the actor's own keyword×location expansion on top of ours. `saveOnlyUniqueItems` still de-dupes
  overlapping locations; the skill-match `resumeKeywords` is unchanged.
- **`max_jobs_per_run` is now the HARD total cap.** When set (>0), `maxItems = max_jobs_per_run`
  exactly (previously `min(results×combos, max_jobs_per_run)` — same effect, but now it's unambiguously
  *the* limit). When unset, it falls back to `results_per_query × #combos`. Always floored to 150.

## Consequences
- The run count is predictable again: set "Max jobs / run" = 500 → at most 500 jobs, regardless of how
  many roles/locations are selected. No more double-fetching.
- Reverts the `locations`-array half of ADR 0017 (which caused the inflation) while keeping its good
  parts (dedup, single run). Skill-match (0018) and scoring v2 (0022) untouched.

## Note
Live behavior only changes after deploy. Existing setups should set "Max jobs / run" to their desired
ceiling (e.g. 500); 0 means "results-per-role × combos", which can still grow with the library.
