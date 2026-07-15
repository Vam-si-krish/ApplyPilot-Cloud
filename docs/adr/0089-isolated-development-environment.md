# ADR 0089: Isolated development environment and promotion flow

- Status: accepted
- Date: 2026-07-15
- Builds on: ADRs 0072, 0073, 0075, and 0088

## Context

`multi-user-fork` now operates as the production branch for the private multi-user
product. Feature work needs a stable environment where migrations, worker behavior,
authentication, and end-to-end flows can be tested before production promotion. A
Netlify branch that points at the production backend would expose real user data and make
test writes indistinguishable from production activity.

## Decision

Create a long-lived `develop` branch and an independently persistent development stack:

- server checkout `/Users/vamsikrish/apps/jobpilot-multi-dev` tracking `develop`;
- database/role `jobpilot_multi_dev` / `jobpilot_multi_dev_app` in the shared PostgreSQL
  cluster, with no production snapshot or synchronization;
- gateway/PostgREST/worker ports `8241`/`8242`/`8243` on `127.0.0.1`;
- container/project identity `jobpilotdev`, Funnel path `/jobpilot-dev`, file tree and
  backups inside the development checkout, and launchd labels `com.jobpilotdev.*`;
- independent database, JWT, storage, worker, auth, cron, and fixed-account secrets;
- Netlify's `develop` branch deploy, using only `branch:develop` environment values and
  the stable Netlify branch URL. The production branch and custom domain remain
  `multi-user-fork` and `apply.vamsikrish.com`.

Netlify scheduled functions do not execute automatically for branch deploys. Development
automation is therefore manual unless a tester explicitly invokes it. Feature work starts
from `develop`, is verified there, and reaches production only by a reviewed merge into
`multi-user-fork`; production is never merged back through an environment-specific data
copy.

Backend operational scripts must derive container, lock, launchd, database, and public
identities from the protected instance environment. The restricted personal-laptop key
may control exactly the two allowlisted instances (`production` and `development`) and
may run one idempotent development provisioner. It still cannot open a shell, forward a
port, operate `com.applypilot.*`, or target arbitrary paths/services.

## Consequences

- Destructive tests and schema migrations cannot affect production rows or files.
- Development starts empty; test data and user-owned API/subscription credentials must be
  added deliberately and are never copied from production.
- Shared physical PostgreSQL/Tailscale/host failure domains remain, but application roles,
  secrets, ports, services, and backups are separate.
- A feature is not production-ready merely because local tests pass: it must pass the
  development branch build, isolated backend checks, and relevant end-to-end workflow.

## Verification gates

1. Production continues healthy on `8231`–`8233`, `/jobpilot`, `jobpilot_multi`, and
   `com.jobpilotmulti.*` after the operational parameterization.
2. Development uses only `8241`–`8243`, `/jobpilot-dev`, `jobpilot_multi_dev`,
   `jobpilotdev-rest`, and `com.jobpilotdev.*`.
3. Authenticated reads/writes and files cannot cross between the two service keys or
   databases; development begins without production history.
4. The `develop` Netlify branch deploy uses the development backend and can complete a
   real login/read/write smoke test. Its scheduled functions do not run automatically.
5. Development autopull, watchdog, backup, restart, logs, and restricted deployment pass;
   production status and a production login remain green.
