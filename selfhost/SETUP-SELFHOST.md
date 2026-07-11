# Self-hosted Supabase — server-laptop runbook

Replaces the Supabase cloud project with this repo's `selfhost/` stack on the
always-on server laptop. Zero app-code changes: the app gets a new
`SUPABASE_URL` + keys, nothing else. Background: `docs/SELFHOST-PLAN.md`.

**Status: phases 0–2 are DONE (2026-07-11)** — the stack is live on the server
laptop, the Funnel URL serves it publicly (`https://vamsis-macbook-pro.tail579e6c.ts.net`),
the data was restored (jobs=4072 / applications=618), the worker points at
localhost, and Netlify was flipped and verified end-to-end (see
`docs/devlog/DAY-13.md`). What remains is **phase 3** below, plus two
recommended follow-ups: healthchecks.io ping URLs (`HC_PING_*` in
`selfhost/.env`) and a second backup destination (`BACKUP_DEST2` — iCloud Drive
is not signed in on the server laptop).

---

## Doing this with Claude Code on the server laptop (recommended)

Pull latest, open Claude Code in the repo on the server laptop, and say:

> **follow selfhost/SETUP-SELFHOST.md — do phases 1 and 2**

Claude can execute almost everything below itself. Ground rules for that session:

- **Scope**: phases 1–2 of this file plus the standard worker update
  (`resume-worker/DEPLOY.md` §1). Never edit app code, never write to the CLOUD
  database (the restore script only *reads* it), never rotate credentials.
- **Human moments** — ask the user, don't work around them:
  1. macOS admin password whenever `sudo` prompts (pmset, Remote Login).
  2. Clicking the Tailscale sign-in link (`tailscale up` prints a URL).
  3. System Settings toggles that need the GUI: auto-login ON, FileVault OFF,
     OrbStack/Docker "Start at login".
  4. The **cloud DB password** for `restore-from-cloud.sh` (deliberately not in
     the repo — the user pastes it when asked).
  5. The **Netlify env flip** (step 4 of phase 2): either the user does it in
     the browser with the values Claude prints, or the user provides a Netlify
     personal access token so Claude can do it via `npx netlify-cli env:set …`
     + trigger a redeploy.
- **Done means verified**: every checkpoint in phases 1–2 passes — `docker
  compose ps` all healthy, the restore prints jobs≈4072 / applications≈618, the
  Funnel URL serves `/rest/v1/jobs?select=id&limit=1` with the anon key from
  the public internet, and after the Netlify flip the live site shows the data
  again. Report each gate's result.

## Phase 1 — one-time bootstrap (~30 min; Claude drives, user supplies clicks/passwords)

On the **server laptop**:

1. **Container runtime**: install [OrbStack](https://orbstack.dev) (preferred —
   lighter, starts at login) or Docker Desktop (`brew install --cask orbstack`).
   In its settings enable **Start at login**, then open it once so the daemon runs.
2. **Tailscale**: install (`brew install --cask tailscale` or App Store), sign
   in. The macOS GUI app **cannot** act as a Tailscale-SSH server, so for
   remote hands from the dev Mac enable plain macOS **Remote Login** instead:
   ```bash
   sudo systemsetup -setremotelogin on    # or System Settings → Sharing → Remote Login
   ```
   The dev Mac (same tailnet) then reaches this machine with ordinary
   `ssh <user>@<machine>.<tailnet>.ts.net`.
3. **Boot resilience** (Terminal):
   ```bash
   sudo pmset -a sleep 0 disablesleep 1     # never sleep (likely already set)
   sudo pmset repeat wakeorpoweron MTWRFSU 03:25:00   # wake before the 03:30 backup
   ```
   System Settings: **auto-login ON** (Users & Groups), **FileVault OFF**
   (Privacy & Security — otherwise an unattended reboot stops at the unlock
   screen), Software Update: **download only, no auto-restart**.
4. Make sure the repo is current (it exists — the worker runs from it):
   `cd ~/Desktop/projects/ApplyPilot-Cloud && git pull`, then do the standard
   worker update from `resume-worker/DEPLOY.md` §1 (this also drops the worker
   back to the reverted, pre-ChatGPT code).

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

## Gotchas learned in phases 1–2 (server laptop, 2026-07-11)

- **macOS TCC silently blocks launchd jobs from reading `~/Desktop`** — the
  watchdog/autopull/backup jobs die with exit 127 (`zsh: can't open input file`)
  or `operation not permitted`, and **no permission prompt ever appears** for
  background jobs. Fix (one-time, GUI): System Settings → Privacy & Security →
  **Full Disk Access** → add **`/bin/zsh`** (⌘⇧G in the file picker) and
  **`/Applications/OrbStack.app`** (the docker CLI is OrbStack's binary with its
  own TCC identity — granting zsh alone is not enough). Note: granting OrbStack
  FDA restarts it, taking the stack down for ~2 min (the stack/watchdog jobs
  bring it back).
- **The Tailscale app's CLI crashes when invoked via symlink**
  (`Fatal error: The current bundleIdentifier is unknown to the registry`).
  Scripts here call bare `tailscale`, so install a **wrapper script** (not a
  symlink) at `/opt/homebrew/bin/tailscale`:
  `#!/bin/sh` + `exec /Applications/Tailscale.app/Contents/MacOS/Tailscale "$@"`.
- **`systemsetup -setremotelogin on` needs Full Disk Access** — enable sshd
  directly instead: `sudo launchctl enable system/com.openssh.sshd && sudo
  launchctl bootstrap system /System/Library/LaunchDaemons/ssh.plist`.
- **`sysadminctl -autologin set` hangs from a non-GUI session** — write
  `/etc/kcpassword` + the `autoLoginUser` loginwindow default directly (what
  System Settings does), after FileVault is off (`fdesetup disable -inputplist`
  works headless).
- **`pg_dump` isn't preinstalled on macOS** — `restore-from-cloud.sh` needs it on
  the host: `brew install libpq` (keg-only; use `/opt/homebrew/opt/libpq/bin`).
