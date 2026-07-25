# ADR 0110: Keyword-mode LinkedIn fetch with native in-search filters

- Status: accepted
- Date: 2026-07-25
- Supersedes the boolean-startUrl LinkedIn strategy of [ADR 0058](0058-linkedin-query-refinement-and-spend-guards.md) (its career-sites portal and cost-guard decisions stand); amends [ADR 0023](0023-fetch-url-driven-hard-cap.md)

## Context

Production fetch volume collapsed from ~500 raw items/run (Jul 17–18) to ~40 (Jul 24)
with identical input. Cross-referencing each run's `chargedEventCounts` and build number
via the Apify API showed the drop tracks the `cheap_scraper~linkedin-job-scraper` actor's
builds 0.0.35–0.0.37 (rolled out 2026-07-19/20), not our settings:

- In **startUrls mode** the new builds crawl only the FIRST page of each URL (~25–60
  jobs) and ignore `maxItems`. The owner account's config produced exactly 2 startUrls
  (one boolean query × {United States, US-remote}), so runs yielded 1–2 pages. A user
  with ~44 locations (44 first-pages) was unaffected — yield now scales with the number
  of searches, not the cap.
- `&start=N` pagination offsets in startUrls are ignored: six offset URLs all returned
  the same first page.
- **Keyword mode still paginates fully** ("Fetching N additional page(s)", 10 jobs/page
  through LinkedIn's guest API) — but only for plain keywords. A quoted
  `"A" OR "B"`-style boolean query (the ADR 0058 optimization) never paginates in either
  mode (~28 items).
- The actor now exposes native in-search filter fields — `experienceLevel`, `jobType`,
  `workType`, `publishedAt` (still `r86400`-format) — that apply before billing, covering
  everything our startUrl facets (`f_E`/`f_JT`/`f_WT`/`f_TPR`) did.

A controlled run with the owner's exact criteria — 4 plain keywords × United States,
entry-level+associate, full-time+contract, last 24 h — returned **225 unique items**
versus the 40 of the same day's production run.

## Decision

- `buildLinkedInInput` always emits **keyword-mode input**: plain `keyword[]` (never a
  boolean query), `locations[]` mapped to unique geos, and the facets expressed through
  the actor's native `jobType: ['full-time','contract']`, `experienceLevel` (mapped from
  the stored f_E digits), and `publishedAt` fields.
- Remote handling: "Remote, US"-style entries collapse into their real geo (a plain geo
  search already includes its remote rows). Only when EVERY saved location is
  remote-flagged does the input add `workType: ['remote']`. An empty location list falls
  back to `United States` — never search worldwide.
- The `fetch_mode` setting becomes inert (column and API field retained for
  compatibility; the Settings selector is removed). `booleanKeywordQuery` and
  `buildLinkedInSearchUrl` are deleted.
- The hard `maxItems` cap, `saveOnlyUniqueItems`, `resumeKeywords` skill-match, cost
  estimation, and the never-send-startUrls-with-keywords rule are unchanged.

## Consequences

- Fetch volume returns to pre-regression levels and now grows with the number of
  keyword × location searches; adding role synonyms is the volume dial (at ~$0.0007/job).
- Exact-phrase precision is lost: bare keywords match more loosely, so slightly more
  off-target rows get billed and scored. The scorer, prefilter, and per-company
  assessment already absorb that noise; the cap bounds the cost.
- If a future actor build restores startUrl pagination, revisiting a precise mode needs
  a fresh ADR with a fresh pagination experiment.
