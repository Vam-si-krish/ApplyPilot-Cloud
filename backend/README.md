# Independent server-laptop backend

This directory turns the `multi-user-fork` branch into a new application with no
dependency on Supabase and no runtime access to the existing ApplyPilot production data.
The architecture decision and phase boundary are recorded in
[ADR 0072](../docs/adr/0072-independent-multi-user-fork-foundation.md).

Phase 2A supports three fixed accounts with forced RLS ownership, user-namespaced files,
and optional UUID-isolated Claude or ChatGPT subscription connections. Public signup remains
deferred; credentials are configured only in Netlify.

## Isolation

- Database: `jobpilot_multi`, owned by `jobpilot_multi_app`, in the shared PostgreSQL
  cluster on `127.0.0.1:54322`.
- API gateway: `127.0.0.1:8231`.
- Database REST service: `127.0.0.1:8232`.
- Resume worker: `127.0.0.1:8233`.
- Public API: `https://vamsis-macbook-pro.tail579e6c.ts.net/jobpilot`.
- Files: `backend/data/` in the independent server checkout.
- Services: `com.jobpilotmulti.*`; production `com.applypilot.*` jobs are untouched.

The gateway implements only the REST and storage protocol used by this app. The
`@supabase/supabase-js` package remains temporarily as a protocol client; there is no
Supabase project or Supabase backend behind it.

The worker is also a deployment-managed boundary. In this fork, Netlify must supply
`RESUME_WORKER_URL` and `RESUME_WORKER_SECRET`; user settings cannot view or redirect
worker traffic (ADR 0075). Claude and ChatGPT credentials live under
`backend/data/claude-users/<uuid>/` and `backend/data/chatgpt-users/<uuid>/`, are never shared across UUIDs, and are included in
mode-`0600` local backups because OAuth refresh credentials may be present. Encrypted
off-host backup handling is required before public signup.

## Install on the server laptop

```bash
mkdir -p ~/apps
git clone --branch multi-user-fork --single-branch \
  https://github.com/Vam-si-krish/ApplyPilot-Cloud.git ~/apps/jobpilot-multi
cd ~/apps/jobpilot-multi
./backend/scripts/bootstrap.sh
```

The bootstrap creates random credentials in `backend/.env`, creates only the new
database/role, applies migrations, installs the isolated services, mounts the Funnel
path, and verifies local and public health endpoints.

## Personal-laptop development and operations

ADR 0088 makes the server laptop an unattended runtime rather than the development
machine. GitHub is the code handoff: every clean push to `multi-user-fork` triggers the
Netlify branch deploy and is picked up by `com.jobpilotmulti.autopull` within five minutes.
Autopull refuses a dirty server checkout, fast-forwards only, applies migrations, reconciles
PostgREST, and restarts the isolated gateway/worker.

For immediate deploys and bounded operations, both Macs must be signed into the same
Tailscale network. In a personal-laptop clone:

```bash
git switch multi-user-fork
./scripts/jobpilot-server setup-key
./scripts/jobpilot-server bootstrap
```

`setup-key` verifies the server's pinned ED25519 host-key fingerprint, generates a
dedicated key on the personal laptop, and asks for the server Mac password once to append
it to `authorized_keys`. The entry uses OpenSSH `restrict` plus a forced command, so this
key cannot get a shell, allocate a TTY, forward ports, run an arbitrary command, or access
the production ApplyPilot services. `bootstrap` retrieves the existing gitignored
`.env.local` only through that encrypted restricted session, writes it with mode `0600`,
installs dependencies, and runs connectivity checks. Never sync that file or the private
key through cloud storage.

Daily commands from the personal laptop:

```bash
./scripts/jobpilot-server deploy                 # push, immediate server sync, wait for commit
./scripts/jobpilot-server status                 # public + launchd/server health
./scripts/jobpilot-server sync                   # fetch/deploy origin without another push
./scripts/jobpilot-server restart worker         # all | backend | worker | rest
./scripts/jobpilot-server logs worker 100         # backend | worker | autopull | watchdog
./scripts/jobpilot-server backup                 # run the existing protected backup job
```

If restricted SSH is temporarily unavailable, a normal `git push origin multi-user-fork`
still deploys: Netlify reacts to the push and server autopull catches it within five
minutes. Public health and deployed worker commit remain readable at `$PUBLIC_URL/health`
and `$PUBLIC_URL/worker/version`.

To revoke a personal laptop, remove its line ending in `jobpilot-personal-control` from
`~/.ssh/authorized_keys` on the server and delete `~/.ssh/jobpilot_server_ed25519*` on that
personal laptop. Re-run `setup-key` to provision a replacement.

## Netlify variables

Set these on the new Netlify site. Secrets are copied from the server laptop's
`~/apps/jobpilot-multi/backend/.env`; never copy the production Netlify values.

```text
BACKEND_URL=<PUBLIC_URL>
BACKEND_SERVICE_KEY=<SERVICE_ROLE_KEY>
RESUME_WORKER_URL=<PUBLIC_URL>/worker
RESUME_WORKER_SECRET=<WORKER_SECRET>
APP_USERS_JSON=<three fixed account objects matching migration 0044 UUIDs>
AUTH_SECRET=<new random value>
CRON_SECRET=<new random value>
NEXT_PUBLIC_APP_URL=<new Netlify/custom-domain URL>
ONBOARDING_SUBSCRIPTION_PROVIDER=chatgpt_subscription
ONBOARDING_SUBSCRIPTION_MODEL=gpt-5.4
```

Apify and LLM keys can be added through the existing Settings UI after login. A fresh
installation starts empty. The current server installation contains the one-time,
owner-authorized snapshot described in ADR 0087 under the `vamsi` UUID; it does not read
from or synchronize with the source database or storage after the recorded cutoff.

After the Netlify URL is known, replace `CORS_ORIGINS` in `backend/.env` and restart
`com.jobpilotmulti.backend`. Server-side Netlify calls do not require CORS, but keeping
the origin accurate is useful for later browser-facing Phase 2 endpoints.

## Applying migrations manually

The autopull service applies migrations and restarts PostgREST automatically. If a
migration is applied directly from this checkout, force the REST schema cache to reload
before testing the web app:

```bash
set -a; source backend/.env; set +a
node backend/migrate.mjs
docker compose --project-directory backend --env-file backend/.env restart rest
curl -fsS "$PUBLIC_URL/health"
```

The explicit restart is required even though the migration runner sends Postgres's
schema-reload notification; PostgREST has occasionally missed that notification.

## One-time owner snapshot migration

[`scripts/migrate-owner-from-production.mjs`](scripts/migrate-owner-from-production.mjs)
exists only for the approved ADR 0087 owner cutover. It is dry-run by default, refuses a
non-empty target history, rewrites ownership to the fixed target UUID, preserves IDs and
relationships, verifies every copied file by size and SHA-256, and never modifies the
source. It deliberately excludes `resume_worker_url` and `resume_worker_secret` because
those are deployment-owned trust-boundary values.

Create and verify database plus storage backups before staging the source storage tree.
Then load the isolated backend environment and run the preview before the explicit write:

```bash
set -a; source backend/.env; set +a
LOCAL_POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
SOURCE_STORAGE_ROOT=/secure/read-only-source-storage \
DESTINATION_STORAGE_ROOT="$PWD/backend/data" \
node backend/scripts/migrate-owner-from-production.mjs

# Only after reviewing the dry-run and confirming that the target account is empty:
LOCAL_POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
SOURCE_STORAGE_ROOT=/secure/read-only-source-storage \
DESTINATION_STORAGE_ROOT="$PWD/backend/data" \
node backend/scripts/migrate-owner-from-production.mjs --execute
```

Do not use this tool for continuous synchronization, public signup, or copying another
person's account. UUID-scoped Claude Keychain credentials are intentionally not portable;
the migrated user reconnects Claude once in Settings. ChatGPT device credentials may be
copied only into that same user's protected UUID directory with mode `0600`.

### Recovering historical application-type metadata

The ADR 0087 snapshot predates the current `applyType` mapping on some rows. The recovery
tool reads only the target user's original Apify datasets and fills only NULL
`easy_apply` values backed by an explicit actor label. It never classifies from a URL:

```bash
LOCAL_POSTGRES_PASSWORD=<local-admin-password> \
node backend/scripts/backfill-easy-apply-from-apify.mjs

# Review the counts, then opt in to the database update:
LOCAL_POSTGRES_PASSWORD=<local-admin-password> \
node backend/scripts/backfill-easy-apply-from-apify.mjs --execute
```

Expired/inaccessible runs remain unknown. Normal ingestion can later enrich an unknown
row if the same URL reappears with explicit metadata, without changing its score or
workflow state.
