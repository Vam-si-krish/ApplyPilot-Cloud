# ADR 0091: Owner-authorized development seed and API-key copy

- Status: accepted
- Date: 2026-07-15
- Amends: ADR 0089

## Context

ADR 0089 correctly starts development empty and prohibits production snapshots or routine
credential synchronization. After the isolated environment was verified, the owner
explicitly requested representative dummy data and their own API keys in development so
real fetching, scoring, tailoring, and the new Tailor & Apply filters can be exercised.

Copying the production database, résumé/files, fixed-login secrets, OAuth/subscription
sessions, or another account's vault would weaken the environment boundary. Manually
retyping nine plaintext vault rows would add handling risk without improving isolation.

## Decision

Permit one bounded, owner-authorized import through `scripts/seed-development.mjs`:

- the target must be the `/jobpilot-dev` backend and the optional key source must be the
  separate `/jobpilot` fork backend;
- all synthetic jobs/applications use fixed fixture UUIDs, the `development_seed` source,
  and the `vamsi` UUID, so the seed is repeatable and identifiable;
- only `vamsi` rows from `api_keys` may be copied, preserving provider, label, secret,
  active state, cooldown, and creation time; the script verifies every copied value in
  memory without logging it;
- the script refuses another user's row and refuses to alter pre-existing development
  keys that are not part of the import;
- no profile/résumé, history, mail/Gmail, file, OAuth/subscription, login, backend service,
  worker, cron, or database-administrator secret is copied.

This is an explicit seed/import action, not synchronization. Future production key
changes do not flow to development unless the owner deliberately reruns the reviewed
command. Development keys may spend the same external provider accounts and must be
deleted or rotated independently when no longer needed.

## Consequences

- Development can exercise real provider boundaries and display meaningful Easy Apply,
  External Apply, queued, ready, applied, failed, and equal-score ATS fixtures.
- External provider spend and rate limits are now a shared failure/cost domain for the
  imported owner keys even though application databases remain isolated.
- Development remains unsuitable for destructive secret-vault tests unless the imported
  keys are removed first.

## Verification

- Automated policy tests prove the target/source guards, synthetic ownership/markers,
  apply-type coverage, equal ATS fixture, and rejection of another user's key row.
- After import, compare only counts/providers/active metadata and in-memory secret values;
  never print raw keys.
- Re-run production/development cross-service-key denial checks and confirm no non-owner
  development rows were introduced.
