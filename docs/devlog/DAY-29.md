# DAY 29 — 2026-07-15 (Isolated development environment)

## Architecture decision

- Recorded ADR 0089: `multi-user-fork` remains production and `develop` becomes the
  integration branch with a completely separate empty runtime.
- Reserved `jobpilot_multi_dev` / `jobpilot_multi_dev_app`, ports `8241`–`8243`,
  `jobpilotdev`, `/jobpilot-dev`, `com.jobpilotdev.*`, and separate files/backups/secrets.
- Chose Netlify's stable `develop` branch deploy with branch-specific secrets; scheduled
  functions do not execute automatically on branch deploys.

## Implementation

- Parameterized Compose and operational scripts so production and development derive
  locks, containers, labels, and restarts from protected instance configuration.
- Extended the forced-command boundary with explicit production/development targets and
  one commit-addressed development provisioner. Added `scripts/jobpilot-dev-server`.
- Added backend regression coverage and deployed the production-safe parameterization
  before provisioning the new runtime.

## Pre-provision verification

- Bash/zsh syntax checks passed. Backend passed 13/13 regressions, including explicit
  target rejection and the exact ADR 0089 resource map.
- The app passed 203 tests with 9 credentialed evals skipped, TypeScript passed, the
  33-page production build passed, and documentation validation passed with 128 Markdown
  files and 83 ADRs.

## Provisioning correction

- The first bounded provision stopped before database/service creation because the shared
  cluster operator could create the development role but could not assign database
  ownership without role membership. The idempotent retry now grants that role only for
  database creation and immediately revokes it; the partial empty role is safely reused.
- The retry applied all 49 migrations and installed the isolated container, five launchd
  jobs, and Funnel path. Services became healthy moments after an eager one-shot final
  probe; provisioning now waits boundedly for launchd/Funnel readiness. The local doctor
  now recognizes Git worktrees whose `.git` metadata is a file.
- Created and pushed `develop`, added a separate personal-laptop worktree, and bootstrapped
  it from the development server's mode-0600 environment. Netlify retains
  `multi-user-fork` as its production branch, allows only that branch plus `develop`, and
  now has independent secret values scoped specifically to `branch:develop`.

## Live verification

- Production and development gateway/worker health passed simultaneously, and both server
  checkouts were clean on their expected branches.
- Correct database and worker secrets returned `200` in their own environments. Both
  production-secret-to-development and development-secret-to-production checks returned
  `401` for the database gateway and protected worker route.
- Development contains zero jobs, applications, runs, and mail messages. Its fixed
  identities are `vamsi`, `surya`, and `samitha`; no production history was copied.
- A real development backup completed through the restricted operator command. The
  development autopull, watchdog, backend, worker, and backup launchd jobs are installed,
  and public `/jobpilot-dev` gateway/worker health is green.
- The first hosted `develop` attempt was blocked by Netlify secret scanning because the
  non-secret `DEPLOYMENT_ENV=development` value appears throughout source and docs. The
  runbook now requires a Builds-scoped `SECRETS_SCAN_OMIT_KEYS=DEPLOYMENT_ENV` exception
  only; all real secrets remain scanned. At the owner's request, the final Netlify deploy,
  branch environment review, and browser login/write smoke test are an explicit handoff.
