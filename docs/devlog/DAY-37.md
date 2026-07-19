# Day 37 — Group-aware default Jobs hide filters

**Date:** 2026-07-16  
**Branch:** `multi-user-fork`

## Goal

Fix the production Jobs view where hiding roughly 50 Tailor & Apply rows could suppress
more than 160 raw postings, and make “Hide applied” plus “Hide in Tailor & Apply” active
by default.

## Implementation

- Enabled both requested hide rules on initial Jobs-page load while preserving literal
  Clear all behavior and the dedicated Applied tab.
- Made both exclusions apply to duplicate-location siblings as well as top-level rows.
- Removed the oversized PostgREST URL shape that repeated Tailor & Apply UUIDs across
  exclusion and duplicate-group clauses; exact exclusions now run over bounded results.
- When an excluded canonical job has eligible duplicate postings, the API now promotes
  one eligible duplicate as representative and retains the other eligible locations
  beneath it instead of dropping the entire group.
- Recorded the amendment to the earlier unconstrained-default decision in ADR 0101 and
  updated the product and architecture summaries.

## Boundaries and risk

- Data owner and caller remain the authenticated user enforced by the existing
  request-scoped database client and forced RLS.
- The change reads existing user-scoped job/application IDs and changes presentation
  only; it adds no schema, migration, secret, worker call, external request, or data
  mutation.
- Deployment target is the production `multi-user-fork` Netlify frontend/API. Persistent
  server services do not require a code restart for this frontend/API-only slice, though
  the guarded production deployment verification remains the release path.

## Pre-deployment verification

- Targeted group-promotion/default-state regression tests pass.
- Full frontend suite passes: 232 tests, with 9 evaluation cases intentionally skipped.
- TypeScript, documentation validation (152 Markdown files and 95 ADRs), the optimized
  production build, and `git diff --check` pass.
- A read-only production-data route probe returns 155 grouped recent rows with Clear all,
  153 with Hide applied, 100 with Hide in Tailor & Apply, and 100 with both enabled. All
  four requests return HTTP 200; the old combined path reproduced an API failure.
- Production health verification remains pending deployment.
