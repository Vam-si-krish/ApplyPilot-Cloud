# DAY 26 — 2026-07-15 (Owner account cutover)

## Architecture and data review

- Reviewed the independent-backend, fixed-account, RLS, storage, worker, credential, and
  documentation boundaries before migration. ADR 0087 records the owner's explicit
  one-time exception to the empty-installation rule without changing the fork's isolated
  runtime topology.
- Confirmed the fixed `vamsi` UUID existed and had no history, keys, or files before use.
  Source and destination database plus storage backups were created with mode `0600`,
  checksummed, listed, and test-restored before any destination write.
- The verified backup set is retained at
  `/Users/vamsikrish/apps/jobpilot-multi/backend/backups/manual-owner-migration-20260715-023151/`
  with a `SHA256SUMS` manifest.
- The migration reads the source through a repeatable-read, read-only transaction. It
  never writes the production database or storage and stops at cutoff
  `2026-07-15T06:40:35.979Z`; there is no continuing sync.

## Implementation

- Added a dry-run-first owner migration tool that preserves IDs/relationships, rewrites
  ownership to `00000000-0000-4000-8000-000000000001`, stages and SHA-256-verifies files,
  excludes deployment-owned worker settings, and refuses non-empty target history.
- Copied 9 API-key rows, 68 runs, 4,726 jobs, 714 applications, 2,549 mail messages, and
  the profile/settings/Gmail/scoring singleton rows. The account is onboarding-complete.
- Copied all 285 physical source objects (41,113,380 bytes) into the `vamsi` namespace.
  The source already lacked 999 referenced historic PDFs: 591 résumés and 408 cover
  letters. Rows were retained truthfully, and the missing-file UX/regeneration decision
  is tracked in the backlog.
- Normalized nine legacy `scored` jobs with no numeric result back to `unscored`, reset
  active scoring flags, and mapped only explicit legacy application-answer facts into
  Candidate Profile. No score or eligibility fact was fabricated.
- Copied the original ChatGPT device login into the protected UUID directory and verified
  it remains logged in. Claude Pro is Keychain-backed and intentionally was not exported;
  `vamsi` must reconnect Claude once in Settings. The Anthropic API key remains available.

## Verification

- Exact post-cutoff source/destination row comparison passed for every copied table after
  the documented score-state normalization and deployment-setting exclusion.
- Relationship checks found zero orphan applications, run references, or duplicate-job
  references. There are zero jobs marked scored without a numeric result.
- Forced-RLS and gateway tests confirmed `vamsi` sees its 4,726 jobs while another fixed
  account sees zero of those rows. Storage signing/download succeeded for `vamsi` and was
  denied for the other account.
- Owner-migration regression tests cover explicit preference mapping and the no-fabricated-
  score normalization. Full app regression passed with 202 tests and 9 credentialed evals
  skipped; backend passed 4/4; worker passed 20/20; TypeScript passed; the 33-page
  production build passed; and documentation validation passed with 123 Markdown files
  and 81 ADRs.
- Push and public service results are appended below after release verification.
