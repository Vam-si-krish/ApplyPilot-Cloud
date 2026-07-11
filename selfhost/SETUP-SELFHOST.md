# Self-hosted Supabase — server-laptop runbook

Replaces the Supabase cloud project with this repo's `selfhost/` stack on the
always-on server laptop. Zero app-code changes: the app gets a new
`SUPABASE_URL` + keys, nothing else. Background: `docs/SELFHOST-PLAN.md`.

**Status: phase 0 (build + full validation on the dev Mac) is DONE** — the real
production data was restored into this stack locally and the app ran against it
end-to-end (login, stats, jobs, storage roundtrip). What remains is phases 1–3
below.

---

## Phase 1 — one-time manual bootstrap (~30 min, the only hands-on step)

On the **server laptop**:

1. **Container runtime**: install [OrbStack](https://orbstack.dev) (preferred —
   lighter, starts at login) or Docker Desktop. In its settings enable
   **Start at login**.
2. **Tailscale**: install from tailscale.com or the App Store, sign in.
   Then enable Tailscale SSH so the dev Mac can drive this machine:
   `tailscale set --ssh`
   Also install Tailscale on the **dev Mac** (same tailnet).
3. **Boot resilience** (Terminal):
   ```bash
   sudo pmset -a sleep 0 disablesleep 1     # never sleep (likely already set)
   sudo pmset repeat wakeorpoweron MTWRFSU 03:25:00   # wake before the 03:30 backup
   ```
   System Settings: **auto-login ON** (Users & Groups), **FileVault OFF**
   (Privacy & Security — otherwise an unattended reboot stops at the unlock
   screen), Software Update: **download only, no auto-restart**.
4. Make sure the repo exists (it does — the worker runs from it):
   `~/Desktop/projects/ApplyPilot-Cloud`

Everything after this happens from the dev Mac over `tailscale ssh` (or
continue in the same terminal).

## Phase 2 — stand up + cut over

```bash
cd ~/Desktop/projects/ApplyPilot-Cloud && git pull
cd selfhost
./scripts/bootstrap.sh
```

`bootstrap.sh` generates fresh secrets into `.env`, pulls ~2 GB of images,
starts the stack, waits for health, enables **Tailscale Funnel** on Kong, and
installs the four launchd jobs (stack-at-login, autopull, watchdog, backup).

Then:

1. Copy the Funnel URL it printed (`https://<machine>.<tailnet>.ts.net`) into
   `selfhost/.env` as `SUPABASE_PUBLIC_URL`, `API_EXTERNAL_URL`, `SITE_URL`,
   then `docker compose up -d` to recreate with it.
2. **Bring the data over** (works even while the cloud API is egress-blocked —
   it uses a direct Postgres connection):
   ```bash
   CLOUD_PGPASSWORD='<cloud db password>' ./scripts/restore-from-cloud.sh
   ```
   Prints row counts at the end — expect jobs≈4072, applications≈618.
3. **Point the worker at localhost** — in `resume-worker/.env`:
   ```
   SUPABASE_URL=http://127.0.0.1:8000
   SUPABASE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY from selfhost/.env>
   ```
   then `launchctl kickstart -k gui/$(id -u)/com.applypilot.resume-worker`.
4. **Cut the app over** — in the Netlify site env:
   ```
   NEXT_PUBLIC_SUPABASE_URL      = https://<machine>.<tailnet>.ts.net
   NEXT_PUBLIC_SUPABASE_ANON_KEY = <ANON_KEY from selfhost/.env>
   SUPABASE_SERVICE_ROLE_KEY     = <SERVICE_ROLE_KEY from selfhost/.env>
   ```
   Trigger a redeploy. Rollback = restore the old env values and redeploy.
5. (Optional but recommended) create three checks at healthchecks.io and paste
   their ping URLs into `selfhost/.env` (`HC_PING_WATCHDOG/BACKUP/AUTOPULL`) —
   you get an email if the machine goes silent, a backup stops, or deploys stop.

## Phase 3 — after the cloud egress restriction lifts (~Jul 17 or Pro)

```bash
CLOUD_URL=https://ftrakpebzcabztwyunum.supabase.co \
CLOUD_SERVICE_KEY='<cloud service key>' ./scripts/sync-storage-files.sh
```
copies the existing resume PDFs (≈226 MB) into local storage. New PDFs already
land locally from day one — this only backfills history. Then take a final
`pg_dump` snapshot of the cloud, and delete the cloud project (the leaked
credentials die with it).

---

## How the zero-touch layer works

| launchd job (every) | does |
|---|---|
| `…selfhost.stack` (login) | `docker compose up -d` after boot |
| `…selfhost.autopull` (5 min) | `git pull` when main moves; npm install worker deps if changed; **applies new `supabase/migrations/*.sql` exactly once** (tracked in `public.schema_migrations`); restarts worker if its code changed |
| `…selfhost.watchdog` (5 min) | probes Kong→PostgREST→DB, the worker, and the public Funnel URL; restarts the failing layer; 3 consecutive fails ⇒ full stack bounce; pings healthchecks when green |
| `…selfhost.backup` (03:30) | `pg_dump` (in-container, version-matched) + storage mirror; copies to iCloud Drive (or `BACKUP_DEST2`); 14-day retention; pings healthchecks |

Day-to-day: **push to `main` from the dev Mac and walk away** — code and schema
converge on the laptop within 5 minutes. DB admin from the dev Mac:
`psql -h <laptop-tailscale-name> -p 54322 -U postgres` — wait, Postgres binds
127.0.0.1 only; use `tailscale ssh` + local psql, or an SSH tunnel:
`ssh -L 54322:localhost:54322 <laptop>` then `psql -h localhost -p 54322`.
Studio (DB browser): `ssh -L 3001:localhost:3001 <laptop>` → http://localhost:3001.

## Gotchas learned in phase 0 (already handled, documented for posterity)

- **roles.sql**: upstream's script aborts on roles our trimmed stack doesn't
  create, leaving the *storage* admin password unset — ours applies each role
  conditionally.
- **Storage needs xattrs**: the file backend stores object metadata in extended
  attributes; macOS bind mounts don't support them ⇒ storage files live in a
  **named Docker volume** (`storage-data`), and backup.sh streams them out via tar.
- **PostgREST healthcheck**: `postgrest --ready` probes the admin server —
  `PGRST_ADMIN_SERVER_PORT` must be set or the container reports unhealthy forever.
- **Port collisions**: another project's containers may squat :8000 (on the dev
  Mac, Skyvern does). `KONG_HTTP_PORT` in `.env` is per-machine.
- **First-boot only**: the db init scripts run only into an empty
  `volumes/db/data`. To re-init: `docker compose down && rm -rf volumes/db/data`.
