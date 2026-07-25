# DAY 46 — 2026-07-25

## ✅ Fetch volume collapse → keyword-mode LinkedIn input (ADR 0110)
Production raw items fell 513 → 40/run with identical input. Cross-referencing each
run's Apify `chargedEventCounts` + build number pinned it to `cheap_scraper` builds
0.0.35–0.0.37 (Jul 19–20): startUrls mode now crawls only page 1 per URL (and ignores
`maxItems`); `&start=` offsets are ignored; quoted boolean OR queries never paginate in
either mode. Keyword mode still paginates fully via the guest API. Controlled runs with
the owner's exact criteria: boolean/startUrls variants ≈ 28 items; 4 plain keywords ×
United States + entry/associate + full-time/contract + 24 h = **225 unique items**.

`buildLinkedInInput` now always emits keyword-mode input with the actor's native
in-search filters (`jobType: full-time+contract`, `experienceLevel` from the stored f_E
digits, `publishedAt`); remote-ish locations collapse into their geo, `workType:
['remote']` only when every location is remote, empty list falls back to United States.
`fetch_mode` is inert (UI selector removed; column/API kept), boolean/URL helpers
deleted.

## ✅ Runs stuck at 'running' → delivered triggers + score-tick watchdog (ADR 0111)
Nearly every recent production run was frozen at `status='running'` with `jobs_scored`
at a multiple of SCORE_BATCH_SIZE: the chain's fire-and-forget `void fetch()`
self-trigger dies when the serverless instance freezes after responding, and nothing
ever restarted the chain (stale-lock takeover existed but had no external driver).

- `triggerScoreBatch` is awaited for request *delivery* only (3 s abort window) by all
  callers — the chain stays parallel, but the request reliably leaves the process.
- New self-authorized `/api/score-tick` + Netlify scheduled function (every 5 min):
  per user, revive dead chains (stale-lock takeover) or, when the queue is empty,
  finalize idle runs.
- `finalizeIdleRuns` closes ALL idle 'running' runs (was: latest only → older
  interrupted runs stuck forever), with a 10-min webhook grace for fresh runs; the
  webhook's zero-insert path now finalizes its own run instead of "latest running".

Once deployed, the ticks drain the stuck production backlog automatically. Tests 263
green; typecheck green.

## ✅ Header location on tailored résumés is now judged, not copied (ADR 0112)
The opt-in `use_job_location_on_tailored_resume` swap pasted the job row's location
verbatim — so remote rows produced "Remote — Los Angeles Metropolitan Area" headers and
a Cambridge posting would displace a Boston candidate's already-local header. Now the
tailoring call itself outputs a `resume_location`: home location for remote / missing /
vague-region / same-metro jobs; the job's city as "City, ST" only when it's clearly a
different metro. Verbatim overwrite removed on both worker and direct paths; sanitized
(≤ 60 chars, single line) with fallback to home; TARGET JOB block now carries the
Location line. Tests cover judged-city, withheld/junk → home, and pref-off → ignored.

## Open questions
- Verify the first `score-tick` firings in the Netlify function log after deploy (the
  `*/5` cadence is the pipeline's only external re-driver on serverless).
- Yield can be pushed further with role synonyms (each keyword × location search
  paginates independently); consider enabling the career_sites portal for ATS-direct
  postings.
