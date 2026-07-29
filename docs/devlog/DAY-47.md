# DAY 47 — 2026-07-28

## ✅ Actor-scoped LinkedIn scraper adapters (ADR 0113)

Integrated `curious_coder~linkedin-jobs-scraper` without changing existing accounts or
starting a billable run. The old Actor ID selector was not a real abstraction: every
actor received `cheap_scraper`'s keyword payload and LinkedIn cost estimation always
assumed its $0.70/1k rate.

- Run planning now resolves an actor adapter that owns the input builder, result cap,
  unit price, and output normalizer.
- Curious Coder accepts one filtered LinkedIn Jobs search URL per line, persists the
  validated/de-duplicated URLs, and sends `urls`, `count`, company scraping, and
  incognito-mode input. Salary arrays and apply-method output normalize into existing
  job fields.
- Callback URLs carry the actor ID so the webhook selects the matching normalizer.
- Cost preflight now uses each run spec's actor-specific cap and price.
- Existing `cheap_scraper` behavior, settings, and default remain unchanged. Legacy
  custom criteria-compatible actors remain backward compatible.

Data ownership remains the current UUID-scoped Settings row and jobs ingestion path.
The caller is the authenticated Settings UI or scheduled run; external input crosses
the boundary at saved LinkedIn URLs and Apify dataset items, both validated/normalized
before persistence. Apify remains the long-running owner, the CRON-secret callback plus
launching vault key remain unchanged, and the deployment target is the isolated
development branch until production deployment is explicitly requested.

Regression coverage proves adapter selection, URL security validation, missing-URL
failure, actor-specific pricing, and Curious Coder output normalization. No production
deployment or live Apify charge was authorized for this slice.

Pre-deployment verification: 269 app tests passed (16 eval cases intentionally skipped),
21 backend/isolation tests passed, typecheck passed, production build passed, and
documentation check passed. The complete 0001–0059 migration chain applied successfully
to a disposable PostgreSQL cluster; `settings.linkedin_search_urls` was verified as a
non-null `text[]` with an empty-array default. The stopped disposable cluster was moved
to Trash after verification.

## ✅ URL-mode settings and actor-default pagination follow-up

The first production URL-mode run returned exactly 10 rows even though the saved Total
run cap was 800. Inspection confirmed ApplyPilot's plan already mapped that setting to
`count: 800`; the 10-row result was therefore not caused by the displayed roles,
locations, age, or per-role settings. Those controls were nevertheless misleading
because Curious Coder ignores them.

- URL mode now hides role, location, lookback, and per-role controls while preserving
  their saved libraries, unless another enabled portal still needs those criteria.
  Skills and local pre-scoring remain visible and active.
- The URL editor and cap control show the exact next-run result request.
- ApplyPilot no longer forces `useIncognitoMode` or `splitByLocation`; it sends only the
  validated URLs, explicit `count`, and company-detail choice so maintained actor
  defaults own pagination behavior.
- No paid verification run was started. A result below the displayed request remains a
  LinkedIn availability or actor-pagination outcome, not a hidden ApplyPilot limit.

Follow-up verification: 269 app tests passed (16 eval cases intentionally skipped), 21
backend/isolation tests passed, typecheck passed, production build passed, and
documentation check passed.

## ✅ Tailor & Apply deletion boundary and bounded recovery (ADR 0114)

Production diagnosis found that Jobs' paginated response correctly removed applied and
Tailor & Apply rows, but its early `idsOnly` response did not. “Select all matching”
therefore selected hidden UUIDs, and per-job deletion triggered the database's intentional
application cascade. A before/after production comparison bounded the incident to two
new queued applications—TalentAlly “Software Engineer” and Epic “Entry-Level Technical
Solutions Engineer.” All 801 generated tailored résumés, 789 PDF pointers, and 752
applied application rows remained present.

- The `idsOnly` projection now carries `applied_at` and applies the exact shared hide
  predicate before returning IDs.
- The per-job delete route independently rejects every application-linked job with
  `409`, so stale client state cannot destroy Tailor & Apply data.
- Bulk delete counts successful, protected, and failed responses instead of treating any
  HTTP response as success.
- The restricted server operator surface gained a one-to-ten-UUID backup recovery path.
  It searches retained backups, extracts only the selected application and linked-job
  `COPY` records, previews non-sensitive row identity/state, and writes the exact rows
  only with an explicit apply command.

Data owner is the authenticated user's forced-RLS jobs/applications pair. The caller is
the signed-in Jobs UI; the trusted deletion boundary is the server route, not the
browser's current filter state. Recovery is a separate owner-authorized production
operator action through the pinned forced-command SSH key. It does not expose a public
endpoint, cross user scope, or mutate storage files.

Pre-deployment verification: 271 app tests passed (16 eval cases intentionally skipped),
22 backend/isolation tests passed, typecheck passed, production build passed,
documentation validation passed, and both operator shells plus the recovery script
passed syntax validation. Production backup preview/restore remains pending.

The first production preview attempt made no data changes and exposed an operator-runtime
gap: the forced-command environment did not inherit the server-managed Node path. The
recovery command now executes through the same bounded login-shell pattern used by
deployment, while preserving the already validated fixed script path, mode, and UUID
arguments.

The second preview likewise made no data changes. It found both UUIDs but returned before
the gzip pipeline drained, surfacing an `EPIPE`. Backup discovery now scans each candidate
archive to completion before choosing it, avoiding premature stream teardown.

The third preview reached the isolated temporary restore, where `psql` closed its input
early and the decompressor's secondary `EPIPE` masked the primary database error. The
recovery pipeline now handles only that expected pipe-close signal and preserves the
actual PostgreSQL diagnostic. No live write path was reached.

The full-database preview was terminated after five minutes without reaching apply.
Recovery now parses PostgreSQL's text `COPY` sections directly in two bounded passes:
first the requested application UUIDs, then only their linked job UUIDs. It also removes
any stale `jobpilot_recovery_*` temporary database from the interrupted attempt before
previewing. No production row or file was changed by the abandoned restore.
