# DAY 14 — 2026-07-14 (independent multi-user fork, Phase 1 foundation)

## Product direction locked

The user clarified that `multi-user-fork` is a **new application derived from the current
ApplyPilot code**, not a second frontend for production. End state: many users create
accounts, each owns all of their data and supplies their own Apify/LLM keys. Frontend is a
new Netlify site/custom domain; backend stays on the server laptop. “Supabase” in an earlier
message was a typo—no Supabase project/cloud backend is wanted.

The delivery boundary is explicit:

- **Phase 1:** empty independent backend + current behavior, owner-only smoke test.
- **Phase 2:** accounts, sessions, user-owned rows/files/API keys, onboarding, authorization,
  and spend/abuse controls. Phase 1 must not be opened for multi-user signup.

Recorded as [ADR 0072](../adr/0072-independent-multi-user-fork-foundation.md) and added to
the PRD/architecture/agent context.

## Branch and implementation

- Created and pushed branch `multi-user-fork` from `main`.
- First code slice: `fca96ee` (`feat: scaffold isolated server backend for app fork`).
- Added `backend/`:
  - gateway on 8231 with service-key protection;
  - PostgREST on 8232 against new DB `jobpilot_multi` / role `jobpilot_multi_app`;
  - independent résumé/LLM worker on 8233, proxied at `/jobpilot/worker`;
  - disk PDF storage with expiring HMAC download links;
  - migration runner over the existing ordered SQL migrations;
  - bootstrap, launchd, autopull, watchdog, and 14-day DB+file backup scripts.
- App and worker now prefer `BACKEND_URL` / `BACKEND_SERVICE_KEY`, while keeping old
  Supabase environment names as production/rollback compatibility.
- Names, ports, database, files, secrets, Funnel path, and launchd labels are distinct;
  no production resources or data were modified.

## Verification completed on the development Mac

| Gate | Result |
|---|---|
| Backend REST/storage compatibility tests | ✅ 2 passed, including real `supabase-js` request shapes |
| App typecheck | ✅ |
| App tests | ✅ 169 passed, 8 live-LLM evals skipped |
| Next production build | ✅ 32 static pages + dynamic routes built |
| Shell syntax, launchd plist lint, Compose render, diff/secret scan | ✅ |

Docker/OrbStack is not running on the development Mac, so the full fresh-database migration
test belongs to the server provisioning gate and is **not claimed complete**.

## Deployment state / blocker

GitHub branch is current, but the server backend is not installed yet. This development
Mac has no Tailscale client/session; the server's SSH endpoint is tailnet-only, so direct
provisioning was unreachable. Next action is either connect this Mac to the tailnet or run
`backend/scripts/bootstrap.sh` from a `~/apps/jobpilot-multi` clone on the server laptop.
After the new Netlify URL is known, set its independent env values from `backend/.env`,
update `CORS_ORIGINS`, and execute every ADR 0072 verification gate before declaring
Phase 1 complete.

## Process correction

This slice initially violated the repository's `research → spec → plan → implement → verify
→ record` discipline: the backend runbook was written, but CLAUDE/PRD/ARCHITECTURE/latest
devlog were not read first and no ADR/devlog was committed with the code. The omission was
caught when the user asked directly. This DAY-14 entry and ADR 0072 repair the record, but
the ordering mistake remains documented rather than hidden.
