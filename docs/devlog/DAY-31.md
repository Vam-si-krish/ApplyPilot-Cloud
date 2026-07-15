# DAY 31 — 2026-07-15 (Development fixtures and owner API keys)

## Owner request and boundary

- The owner explicitly requested dummy development data and their existing API keys in
  the isolated development environment.
- Recorded ADR 0091 as a narrow amendment to ADR 0089. The exception covers only
  synthetic `vamsi` fixtures and production `vamsi.api_keys` rows; it excludes profiles,
  résumés, history, mail/Gmail, files, OAuth/subscription sessions, fixed-login values,
  and deployment/backend secrets.

## Implementation

- Added `scripts/seed-development.mjs`, which refuses non-development targets, uses
  fixed fixture UUIDs/source markers, is repeatable, and never logs raw API keys.
- The fixture set covers Easy Apply, explicit External Apply, null-source External Apply,
  queued/ready/applied/failed/parked states, improved ATS comparison, and unchanged
  `61% → 61%` comparison.
- Key import remains behind `--copy-owner-keys`, validates every source row belongs to
  `vamsi`, refuses unrelated existing development keys, preserves active/cooldown state,
  and verifies secrets in memory after writing.

## Verification

- Policy tests pass for target/source refusal, fixture ownership/markers, apply-type
  coverage, equal ATS coverage, allowed-field projection, and non-owner rejection.
- The live seed created five jobs and five applications: two Easy Apply, two explicit
  External, one null-source External, one each queued/applied/failed, two ready, and one
  parked. Stored comparisons include `52% → 74%` and unchanged `61% → 61%`.
- Imported nine `vamsi` vault rows: one each for OpenAI, Anthropic, and DeepSeek plus six
  Apify keys. Active/cooldown state and secret equality were verified without printing
  key values. Development runs and mail remain empty.
- All jobs, applications, and keys belong only to the `vamsi` UUID; Surya and Samitha see
  zero rows. Production keys against development and development keys against production
  both return `401`.
- Full gates passed: 207 app tests with 9 credentialed evals skipped, 16 backend
  regressions, 20 worker tests, TypeScript, the 33-page production build, and docs
  validation across 133 Markdown files and 85 ADRs.
- Commit and development code deployment remain pending.
