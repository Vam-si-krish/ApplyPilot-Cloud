# DAY 48 — 2026-07-29

## Fifth production fixed account (ADR 0115)

The owner authorized a fifth production-only account named Ruby with the explicitly
supplied six-character initial password.

- Added Ruby to the fixed identity allowlist with stable UUID
  `e434e565-6be0-4c9e-b396-0f2323cf6045`.
- Added migration 0060 to create Ruby's identity and empty Profile, Settings, Gmail, and
  scoring singleton rows with automatic scraping disabled.
- Bounded the weaker password exception to Ruby's UUID. Every other fixed account retains
  the ten-character minimum.
- Kept the credential out of source and development; it will be added only to Netlify's
  production `APP_USERS_JSON`.

The data owner is Ruby's stable UUID. The caller is the browser after Netlify validates
the fixed credential and signs an identity session. Middleware replaces caller identity,
the gateway signs a short-lived user JWT, and forced RLS plus UUID-scoped files and
worker calls preserve isolation. The password crosses only Netlify's server-side
authentication boundary. Production Netlify and the isolated `jobpilot_multi` database
are the deployment targets.

The short password is materially weaker and the public fixed-account login does not yet
have the abuse controls deferred to Phase 2B. The exception does not weaken another
account.

Pre-deployment verification passed: 274 app tests passed (16 eval cases intentionally
skipped), backend passed 23/23, résumé-worker passed 23/23, typecheck passed, the
optimized production build passed, documentation validation passed, and `git diff
--check` passed. The complete 0001–0060 migration chain applied to a disposable
PostgreSQL 17 instance; Ruby had exactly one identity/Profile/Settings/Gmail/scoring row
and automatic scraping was disabled. Production backup, migration, secret update, login,
isolation, and health verification remain pending deployment.
