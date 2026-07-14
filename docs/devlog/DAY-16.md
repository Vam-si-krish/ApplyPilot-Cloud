# DAY 16 — 2026-07-14 (architecture and documentation audit)

## Review

- Reconciled `CLAUDE.md`, README, PRD, architecture, AI workflow, backlog, backend, and
  worker runbooks against the current `multi-user-fork` implementation and ADRs.
- Removed stale claims that Phase 1 or exact ApplyPilot-Lite scoring parity are current.
  The living docs now describe fixed-account Phase 2A, the weighted v2 scoring contract,
  per-user keys/Claude connections, forced RLS, and the independent backend topology.
- Marked old Cloudflare/Supabase worker and self-hosting instructions as legacy so they
  are not accidentally applied to `com.jobpilotmulti.*` services.

## Architecture correction

- Found that inherited settings could let a fork user override the server-side résumé
  worker URL/secret, contradicting the trusted deployment topology and creating a
  server-side request-redirection risk.
- Added `lib/workerConfig.ts` and routed every worker call through it. Managed fork
  deployments now use environment configuration only and fail closed; Settings hides,
  withholds, and ignores worker configuration. Legacy single-owner behavior is retained
  only when `BACKEND_URL` is absent.
- Recorded the boundary in ADR 0075 and added unit coverage for managed precedence,
  fail-closed behavior, and legacy compatibility.

## Durable development process

- Added root `AGENTS.md` with mandatory pre-change architecture/ADR review, multi-user
  invariants, verification gates, and documentation requirements.
- Added `docs/DEVELOPMENT.md` with the project lifecycle and definition of done.
- Added `npm run docs:check` to verify required living docs, local Markdown links, unique
  ADR numbers, and devlog presence.

## Verification

- `npm run docs:check`: 101 Markdown files and 69 ADRs passed; broken historical links
  found by the first run were corrected.
- App: 175 tests passed (8 credentialed live evals skipped), typecheck passed, and the
  33-page production build passed.
- Backend: 2/2 tests passed. Worker: 6/6 tests passed.
- Public read-only health passed for the gateway/database API and browser-capable worker.
  The newest database/files backups were present with mode `0600`.
- A production-server login smoke test confirmed `/api/settings` reports the managed
  boundary while withholding both the worker URL and secret.

## Account reset operation

- Took a fresh database/files backup, then reset the only completed test account,
  `pilot2` (UUID ending `0002`), while preserving its fixed login identity.
- Cascaded its user-owned database data, recreated empty profile/settings/Gmail/scoring
  singletons, and removed its namespaced résumé and Claude credentials.
- Verified the configured login still succeeds, onboarding is false, both user
  directories are absent, the other accounts retain their singleton rows, and public
  gateway/worker health remains green.

## Apify first-run fix for new accounts (ADR 0076)

- Pilot accounts inherited `bebity~linkedin-jobs-scraper`, which now requires a
  $29.99/month rental plus usage. A valid user-owned Apify key therefore failed before
  the first scrape.
- Added migration 0045: future rows default to the already-supported pay-per-result
  `cheap_scraper~linkedin-job-scraper`; only Pilot 2/3 inherited Bebity rows change,
  Vamsi/custom choices remain untouched, and their cooldown is cleared for one fresh
  credit check.
- Settings now identifies cheap_scraper as the recommended pay-per-result option and
  labels Bebity as a paid rental. Official actor pages and trade-offs are in ADR 0076.
- Verification: 175 app tests passed (8 credentialed evals skipped), backend 2/2 and
  worker 6/6 tests passed, typecheck and the 33-page production build passed. Live
  migration and a real user fetch remain the deployment verification step after server
  autopull.
