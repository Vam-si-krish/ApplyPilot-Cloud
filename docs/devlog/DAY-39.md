# Day 39 — Fourth production fixed account

**Date:** 2026-07-16  
**Branch:** `multi-user-fork`

## Goal

Provision Rishab as a fourth production-only fixed account without replacing the three
existing users or adding the identity to development.

## Implementation

- Extended the fixed-account allowlist with stable UUID
  `578fcb56-5900-4d0d-be20-6b6c191554b7` while retaining three-account compatibility for
  the isolated development environment and the production rollout window.
- Added migration 0053 to create Rishab's identity and empty Profile, Settings, Gmail,
  and scoring singleton rows with automatic scraping disabled.
- Added authentication regression coverage and recorded the bounded fixed-account
  expansion in ADR 0103.

## Boundaries and risk

- The authenticated browser/Netlify session remains the caller; the stable UUID is the
  owner carried through middleware, gateway JWTs, forced RLS, files, and worker calls.
- The password remains only in the Netlify production secret. Development configuration,
  source control, logs, and server runtime files do not receive it.
- Production database and Netlify production are the only deployment targets. Existing
  accounts and their rows remain unchanged.

## Pre-deployment verification

- Targeted auth coverage passes for three-account compatibility, Rishab login, baseline
  retention, and unknown-UUID rejection.
- Full frontend suite passes: 236 tests, with 9 evaluation cases intentionally skipped;
  backend passes 19/19 and résumé-worker passes 20/20.
- TypeScript, documentation validation (156 Markdown files and 97 ADRs), optimized
  production build, and `git diff --check` pass.
- Backup, migration, production secret update, login/isolation smoke, and health
  verification remain pending deployment.
