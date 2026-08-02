# DAY 50 — 2026-08-02

## Saved and independently active LinkedIn URL library (ADR 0117)

The production URL-driven LinkedIn Settings flow exposed multiple sources only through a
newline-delimited textarea and treated every persisted URL as active. It now presents a
saved-source table: one Add field, one row per normalized URL, an independent Active
checkbox, and Remove. Any number of saved rows up to 20 can remain active together; an
inactive row stays available for a future run. The existing Save settings action persists
the library and active subset atomically from the browser's perspective.

- Added `settings.linkedin_search_url_options` and losslessly seeded it from each
  account's current active URL array. `linkedin_search_urls` remains the actor-facing
  active subset.
- Added boundary validation for both arrays, including order-preserving de-duplication,
  the 20-source cap, URL safety rules, and automatic promotion of a newly active URL into
  the saved library. The former frontend therefore remains deployment-overlap compatible.
- Updated Curious Coder run planning coverage to prove inactive sources do not reach
  Apify and multiple active sources remain supported under the existing global result
  cap.
- De-duplicated exact job URLs immediately after actor mapping, before local ATS matching
  and persistence. The per-user URL unique key remains the final guard; same-day
  different-URL copies still use the established sibling grouping instead of data loss.

The data owner is the authenticated user's forced-RLS Settings and Jobs rows. The caller
is the signed-in Settings browser for writes and the signed-in/manual or CRON-authorized
run route for reads. Untrusted LinkedIn URLs are validated before persistence and Apify
dataset items are normalized before ingestion. Apify remains the long-running owner; its
request still uses only the current user's vault key, and callback dataset access remains
pinned to that same key. The deployment target is the explicitly requested
`multi-user-fork` production site and isolated `com.jobpilotmulti.*` services; the legacy
ApplyPilot production stack and every development resource remain out of scope. No live,
billable actor run is part of verification.

Pre-deployment verification passed: 284 application tests passed (16 eval cases
intentionally skipped), backend/isolation passed 23/23, résumé-worker passed 23/23,
TypeScript passed, the optimized production build passed, documentation validation
passed, and `git diff --check` passed. The complete 0001–0061 migration chain applied to
a disposable PostgreSQL 16 database; a simulated pre-0061 Settings state then proved all
five active URL arrays backfill unchanged into the saved library. The disposable
container was stopped and removed. Deployment, migration, and live health verification
remain pending.

The protected production database/file backup completed before deployment. Production
reported a clean `d19bbe0` checkout, healthy gateway/database API, current worker, and
healthy public Funnel before the backup. Deployment, live migration, and post-deploy
health remain pending.
