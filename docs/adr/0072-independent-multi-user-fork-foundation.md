# ADR 0072 — Independent server-laptop foundation for the multi-user app fork

**Status:** accepted · **Date:** 2026-07-14 · **Builds on:** ADR 0020 (Netlify), ADR 0027
(worker), ADR 0032 (self-healing worker), and the server-laptop playbook

## Context

The user wants to turn the application built so far into a **new product**: multiple people
will create accounts, keep their data separate, and use their own Apify/LLM API keys. This
is not a new UI pointing at the owner's ApplyPilot backend. It needs its own domain and
Netlify site, with the backend on the server laptop instead of Supabase/cloud services.

The first requested milestone is infrastructure, not multi-user behavior: deploy the
current app against an empty independent backend, prove it works, and add accounts/user
ownership in Phase 2. A duplicate Netlify site using production environment variables was
explicitly rejected because it would expose and mutate production profile, jobs, settings,
résumés, Gmail records, and API keys.

Constraints from `selfhost/NEW-BACKEND-PLAYBOOK.md`:

- share the existing PostgreSQL cluster process but create a database and role per app;
- bind services to unused `127.0.0.1` ports and publish only a Funnel subpath;
- never touch ports 8000/54322/3001/8787, `applypilot-*` containers,
  `com.applypilot.*` labels, the production `postgres` database, or the Funnel root;
- install autopull, watchdog, and backup jobs so the server remains zero-touch.

## Options considered

1. **New Netlify site + copied production variables.** Fastest visual smoke test, but it
   is the same backend/data and creates an unacceptable privacy and mutation risk. Rejected.
2. **New Supabase Cloud project.** The user clarified “Supabase” was a typo and explicitly
   wants the server laptop as the backend. Rejected.
3. **A second PostgreSQL container/full Supabase stack.** Duplicates the shared database
   service, adds operational weight, and violates the per-app-database playbook. Rejected.
4. **Rewrite all data access into bespoke HTTP endpoints immediately.** Clean long-term
   boundary, but `lib/db.ts` and the worker already use a large tested PostgREST query
   surface. Rewriting it before the isolation smoke test expands risk and delays Phase 1.
5. **Separate database + small compatibility gateway + PostgREST.** Preserves the tested
   app query behavior while moving persistence, storage, worker, secrets, and operations
   completely off production. Accepted for Phase 1.

## Decision

### Two phases with a hard release boundary

- **Phase 1 (this ADR):** stand up an isolated single-user baseline. Keep the existing
  shared-password cookie and singleton profile/settings/scoring rows temporarily. It may
  be used for owner-only smoke testing, but it is not safe for public signup.
- **Phase 2:** implement real identity and multi-tenancy before adding users. Every domain
  row and stored file becomes user-owned; every query/worker action is authorized for that
  user; API keys are per-user; onboarding starts with empty user data. Add rate/spend and
  abuse controls before public access.

### Independent Phase 1 resources

- Internal app name `jobpilotmulti`; database `jobpilot_multi`; owner role
  `jobpilot_multi_app`.
- Gateway on `127.0.0.1:8231`, PostgREST on `127.0.0.1:8232`, independent worker on
  `127.0.0.1:8233`.
- Funnel path `/jobpilot`; one public base URL serves REST, signed file downloads, health,
  and a proxied worker path.
- Files live under the fork checkout's `backend/data/`; backups contain the new database
  plus this directory and retain 14 days.
- Launchd labels use `com.jobpilotmulti.*`; the REST container is
  `jobpilotmulti-rest`. Production names and reserved ports remain untouched.
- Random database, JWT, storage-signing, and worker secrets are generated only on the
  server into gitignored `backend/.env`.

### Compatibility boundary

The app continues to call `@supabase/supabase-js`, but only as a PostgREST/storage protocol
client. `BACKEND_URL` / `BACKEND_SERVICE_KEY` override the old Supabase variables. The
gateway requires the service key before proxying `/rest/v1`, stores PDFs on local disk,
and returns short-lived HMAC-signed download URLs. The key exists only in Netlify's
server-side environment and the server worker; no client component receives it.

This compatibility layer is intentionally narrow. Phase 2 may replace it with an
identity-aware API or add database row policies, but that decision must be recorded after
the authentication/user model is designed.

## Consequences

- The fork cannot read production rows even if its frontend is compromised with its own
  service key; its JWT secret, database, role, file tree, and worker secret are distinct.
- Sharing the PostgreSQL cluster saves memory and backup machinery, but cluster-superuser
  compromise remains a shared physical failure domain. App credentials do not have that
  privilege.
- Phase 1 migrations can reuse the existing schema and application behavior, making an
  end-to-end comparison meaningful.
- Phase 1 is **not multi-user**. Deploying it publicly for account creation before the
  Phase 2 identity/ownership migration would mix users in singleton records and is
  prohibited by this decision.
- The server must be reachable over the tailnet to provision and verify the database,
  services, Funnel path, recovery, and backup gates. Code/build completion alone is not a
  completed Phase 1 deployment.

## Verification gates

1. Backend unit/compatibility tests and the existing app typecheck/tests/build pass.
2. All SQL migrations apply to a fresh `jobpilot_multi` database.
3. Local `/health`, authenticated REST read/write, upload, and signed download pass.
4. Public `/jobpilot/health` and the same real operations pass through Funnel.
5. The new Netlify deployment completes a real application action against the new data.
6. All five `com.jobpilotmulti.*` jobs appear; killing the API/worker demonstrates recovery.
7. A database+files backup is produced and inspected.
