# DAY 29 — 2026-07-15 (Isolated development environment)

## Architecture decision

- Recorded ADR 0089: `multi-user-fork` remains production and `develop` becomes the
  integration branch with a completely separate empty runtime.
- Reserved `jobpilot_multi_dev` / `jobpilot_multi_dev_app`, ports `8241`–`8243`,
  `jobpilotdev`, `/jobpilot-dev`, `com.jobpilotdev.*`, and separate files/backups/secrets.
- Chose Netlify's stable `develop` branch deploy with branch-specific secrets; scheduled
  functions do not execute automatically on branch deploys.

## Implementation in progress

- Parameterized Compose and operational scripts so production and development derive
  locks, containers, labels, and restarts from protected instance configuration.
- Extended the forced-command boundary with explicit production/development targets and
  one commit-addressed development provisioner. Added `scripts/jobpilot-dev-server`.
- Added backend regression coverage. Live provisioning and isolation verification remain
  pending the production-safe operational rollout.

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
