# DAY 28 — 2026-07-15 (Personal-laptop development and server control)

## Architecture review

- Confirmed the isolated server already has a clean branch checkout, a five-minute
  fast-forward-only autopull, launchd restart/recovery services, public health/version
  endpoints, an online private Tailscale identity, and macOS SSH listening on port 22.
- No public GitHub SSH key or server `authorized_keys` entry existed. ADR 0088 chooses a
  dedicated forced-command key over a general shell, public restart webhook, or placing
  backend/app secrets in hosted CI.
- GitHub remains the source handoff: a push triggers Netlify and autopull remains the
  no-SSH fallback. The restricted path only accelerates/observes the existing deployment
  process and cannot target the original `com.applypilot.*` services.

## Implementation

- Added `scripts/jobpilot-server` for one-time key/bootstrap setup plus deploy, sync,
  status, targeted restart, bounded logs, and backup operations from the personal laptop.
- Added the forced server command with exact allowlisting, input validation, no `eval`,
  a 500-line log cap, fixed service/log targets, health verification, and a required SSH
  session. The personal setup pins the server ED25519 host-key fingerprint and uses
  `restrict` to disable shells, TTYs, forwarding, and arbitrary commands.
- The encrypted `bootstrap` path retrieves the existing gitignored fork `.env.local`,
  validates required variable names, writes it at mode `0600`, installs dependencies, and
  runs connectivity checks without displaying secrets. The server copy was tightened
  from mode `0644` to `0600` before enabling this command.
- Updated the Architecture, PRD, development protocol, agent map, root README, and backend
  runbook so personal-laptop development is the documented default.

## Verification

- Bash/zsh syntax checks and the public-only CLI status/doctor paths passed. Backend
  regression tests verify the documented command surface and reject shell syntax,
  over-limit logs, unknown commands, and multiline requests without evaluation.
- Full app regression passed with 203 tests and 9 credentialed evals skipped; backend
  passed 8/8; worker passed 20/20; TypeScript passed; the 33-page production build passed;
  and documentation validation passed with 126 Markdown files and 82 ADRs.
- Restricted SSH end-to-end deploy/restart/status, backup/log bounds, push, and public
  rollout results are appended after the server receives the forced-command script.
- Pushed implementation commit `6539e64` and deployed it through the normal isolated
  autopull path. A temporary ED25519 key with the exact production `restrict`/forced-command
  entry then passed help, status, protected dev-environment validation, bounded logs,
  immediate deploy verification, worker restart, and a real backup. An arbitrary shell
  request was rejected with the expected allowlist error.
- The temporary credential was removed after testing; `authorized_keys` contains zero
  active keys until the personal laptop runs `setup-key`. The test backup produced an
  11.2 MB database dump and 40.9 MB file archive at mode `0600`. Public gateway health and
  worker version both passed on `6539e64` after restart.

## Fixed-account rename preparation

- Added migration 0049 to rename only the fixed UUID ending `0002` from `pilot2` to
  `surya` and UUID ending `0003` from `pilot3` to `samitha`; stable UUID ownership and
  the `vamsi` owner snapshot remain unchanged.
- Updated the environment example and auth fixtures for the new usernames. Actual
  passwords remain solely in Netlify's secret `APP_USERS_JSON` and were not committed.
- The focused auth regression passed (2/2), along with documentation validation (126
  Markdown files and 82 ADRs), TypeScript, and the 33-page production build.
- Installed the restricted personal-laptop key through the pinned Tailscale route and
  bootstrapped the protected development environment. Linked Netlify CLI only to the
  isolated `apply.vamsikrish.com` project and updated its secret `APP_USERS_JSON` for
  production, deploy-preview, and branch-deploy contexts; the original
  `applypilot.vamsikrish.com` project was not selected.
- Protected-configuration checks confirmed `vamsi` is unchanged, the two new credentials
  authenticate to UUIDs ending `0002`/`0003`, and the former pilot usernames are rejected.
  Netlify production then returned valid sessions for `vamsi`, `surya`, and `samitha`,
  while both former pilot usernames returned HTTP 401.

## Restricted-deploy reconciliation fix

- The first account-rename deploy fast-forwarded the server checkout to `03481e3` but
  stopped before migration 0049 because the forced-command environment could not locate
  the server's login-shell Node installation. The database was checked explicitly and
  still contained the old pilot names; no successful migration was assumed.
- Added an explicit bounded `--reconcile` mode to autopull and made restricted deploys
  invoke it through a login shell. A repeated deploy can now finish migrations and
  service reconciliation even when an earlier attempt updated Git before failing.
- Zsh syntax checks and all 9 backend regressions passed, including coverage that the
  forced deploy path uses login-shell reconciliation.
- A second bounded sync at `cdcf510` reconciled the partial update, applied migration
  0049, restarted the isolated services, and left the server checkout clean. Authenticated
  backend verification returned `vamsi`/`surya`/`samitha` for UUIDs ending
  `0001`/`0002`/`0003`. Netlify published the same commit successfully at
  `apply.vamsikrish.com`; the original production project remained untouched.
