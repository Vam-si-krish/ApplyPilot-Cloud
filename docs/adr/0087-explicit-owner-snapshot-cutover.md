# ADR 0087: Explicit owner snapshot cutover

- Status: accepted
- Date: 2026-07-15
- Builds on: ADRs 0072, 0073, 0074, 0075, 0077, 0079, 0080, and 0081

## Context

The `multi-user-fork` was built as an independent product with an empty database and no
runtime access to ApplyPilot production. After validating the fixed-account and RLS
foundation, the owner explicitly requested that their complete original account become a
normal user in the fork so they can use this product going forward.

Pointing the fork at production, sharing a storage tree, or keeping two-way synchronization
would defeat ADR 0072. Manually recreating only the profile would lose job, application,
mail, provider, and document history. The migration therefore needs to be an auditable,
one-time cutover that preserves the independent topology.

The source contains legacy inconsistencies. Nine jobs were marked `scored` without a
numeric `fit_score`, which violates the current persisted-score invariant. Application
rows reference 703 résumé PDFs and 523 cover-letter PDFs, but 591 and 408 respectively no
longer exist in source storage. Source storage contains 285 physical objects, including
58 that are not referenced by a current application. A migration cannot recreate bytes
that are absent from the source.

The original Claude Pro login is held in the owner's macOS Keychain rather than a portable
credential file. The original ChatGPT/Codex device login has a portable credential file,
but it must never be placed in another user's namespace.

## Decision

Authorize exactly one owner-account snapshot into the fixed `vamsi` UUID
`00000000-0000-4000-8000-000000000001`:

1. Take and verify source/destination database and storage backups before writing.
2. Read the source in a repeatable-read, read-only transaction. Preserve primary IDs,
   foreign-key relationships, timestamps, profile, settings, API-key rows, runs, jobs,
   applications, mail, Gmail connection, and scoring state while rewriting every owner
   field to the target UUID.
3. Copy every physical source object into the target UUID namespace and verify its byte
   size and SHA-256 digest before atomically promoting the staged tree.
4. Exclude `resume_worker_url` and `resume_worker_secret`; these remain deployment-owned.
   Reset in-progress scoring flags. Convert only `scored` rows lacking `fit_score` to
   `unscored` with no `scored_at` value; never invent a numeric score.
5. Map only explicit legacy application-answer fields into Candidate Profile preferences.
   Missing eligibility, sponsorship, clearance, or avoidance facts remain unknown.
6. Copy the ChatGPT login only into the protected `vamsi` UUID directory. Do not export
   or imitate the Keychain-backed Claude login; the owner reconnects Claude once through
   Settings. Preserve the user-owned Anthropic API key without silently switching the
   configured subscription billing lane.
7. Stop at a recorded cutoff. The source remains untouched and no continuous sync,
   shared database, shared file tree, or runtime production dependency is introduced.

The migration utility is dry-run by default, refuses non-empty target history, checks ID
collisions and relationships, and does not print profile content or credentials. It is an
operator cutover tool, not an account-import API.

## Consequences

- The owner can log in as `vamsi` and continue in the multi-user product with all source
  rows and every source file that still physically exists.
- Other fixed accounts remain isolated by forced RLS, gateway identity replacement,
  UUID-scoped storage signing, and UUID-scoped subscription directories.
- The original deployment remains operational and unchanged at cutoff, but later source
  activity will not appear in the fork. The owner should use the fork going forward.
- Historic application rows whose source files were already absent remain preserved, so
  their missing downloads need a truthful UI/regeneration policy rather than fabricated
  files. The backlog tracks that follow-up.
- Backups and copied OAuth/API credentials are sensitive local artifacts and must retain
  restricted permissions. Credential encryption and encrypted off-host backups remain
  Phase 2B gates before public signup.
