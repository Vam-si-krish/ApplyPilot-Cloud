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
