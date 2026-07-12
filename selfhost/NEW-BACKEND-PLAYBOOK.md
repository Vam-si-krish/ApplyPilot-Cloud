# Server-Laptop Backend Playbook — build any app on Vamsi's own infrastructure

**Audience: any AI coding agent** (Claude Code, Codex/GPT, or other) asked to build an
application "with a proper backend on the server laptop instead of the cloud". This is a
complete, tool-agnostic recipe. It was distilled from building ApplyPilot-Cloud's
self-hosted stack (see `SETUP-SELFHOST.md` in this folder for that system's runbook).

**The pattern in one sentence:** backend (database + API + files) runs on the always-on
server laptop and is published at a stable public HTTPS URL via Tailscale Funnel; the
frontend deploys on Netlify and talks to that URL; launchd keeps everything self-healing
and auto-updating so nobody ever has to touch the laptop.

---

## 1. Inventory — what already exists (don't rebuild it)

| Thing | Value |
|---|---|
| Server laptop | always on, never sleeps, auto-login, FileVault off, survives reboots |
| Container runtime | OrbStack (starts at login), `docker` + `docker compose` on PATH |
| Public door | Tailscale Funnel → `https://vamsis-macbook-pro.tail579e6c.ts.net` |
| Postgres 17 cluster | `applypilot-db` container, host port `127.0.0.1:54322`, superuser `postgres` (password: `POSTGRES_PASSWORD` in `~/Desktop/projects/ApplyPilot-Cloud/selfhost/.env` **on the laptop** — never copy it off-machine) |
| Remote access | from the dev Mac: `ssh <macos-user>@vamsis-macbook-pro.tail579e6c.ts.net` (plain sshd over the tailnet; `tailscale status` lists peers) |
| Proven launchd patterns | `~/Desktop/projects/ApplyPilot-Cloud/selfhost/{scripts,launchd}/` — autopull (git pull + deps + restart every 5 min), watchdog (probe + restart), nightly backup |

## 2. Reserved — never touch these (ApplyPilot production)

- **Ports:** 8000 (Kong), 54322 (Postgres host bind), 3001 (Studio), 8787 (resume worker), 22.
- **Containers/volumes** named `applypilot-*`; **launchd labels** `com.applypilot.*`.
- **The Funnel root** (`/` on port 443 proxies ApplyPilot's Kong). New apps mount under a
  **path** (see §3.4) or on Funnel's other port slots (8443, 10000 — only two, spend wisely).
- The Postgres **cluster is shared, its `postgres` database is ApplyPilot's**. New apps get
  their own database + role (§3.2), never tables in ApplyPilot's.
- Repo `~/Desktop/projects/ApplyPilot-Cloud` auto-pulls `main` every 5 min — never leave
  uncommitted changes there.

## 3. Recipe for a new app (e.g. "build me a Splitwise-style app")

Work on the laptop directly, or from the dev Mac over SSH. Apps live in `~/apps/<name>`.

### 3.1 Repo & skeleton
New GitHub repo. Monorepo layout works well: `frontend/` (Vite/Next) + `backend/`
(API server) + `db/migrations/*.sql` (numbered, idempotent). Clone to `~/apps/<name>`.

### 3.2 Database — one new database in the existing cluster
```bash
# on the laptop; password from ApplyPilot's selfhost/.env (PGPASSWORD env var)
psql -h 127.0.0.1 -p 54322 -U postgres <<SQL
create role <name>_app login password '<generate 32 alnum chars>';
create database <name> owner <name>_app;
SQL
```
Backend connects with `postgres://<name>_app:<pw>@127.0.0.1:54322/<name>`. Store the
password only in `~/apps/<name>/backend/.env` (gitignored). No second Postgres container —
one cluster, many databases.

### 3.3 Backend — a real API server (simplest that works)
Node (Express/Fastify) or Python (FastAPI). Listen on **127.0.0.1:<port>** — pick a free
port in 8200–8999 (`lsof -nP -iTCP -sTCP:LISTEN` first). Must have:
- `GET /health` returning `{ok:true}` (the watchdog probes it),
- CORS allowing the Netlify origin(s),
- migrations applied on boot (read `db/migrations/`, track in a `schema_migrations` table
  — copy the logic from ApplyPilot's `selfhost/scripts/autopull.sh`),
- file uploads (if any) to `~/apps/<name>/data/` on disk — no S3 needed at this scale.
Run it as launchd job `com.<name>.server` (template: ApplyPilot's worker plist; logs to
`~/apps/<name>/logs/`). Full-Disk-Access for `/bin/zsh` is already granted, so launchd
jobs can read the home directory (this was a hard-won fix — don't move binaries around).

### 3.4 Public URL — mount on the shared Funnel hostname under a path
```bash
tailscale funnel --bg --set-path /<name> http://127.0.0.1:<port>
tailscale funnel status        # verify the mount
```
Public base URL: `https://vamsis-macbook-pro.tail579e6c.ts.net/<name>`. The backend must
tolerate the `/<name>` prefix (either strip it via a router prefix setting or mount all
routes under it). Funnel config persists across reboots.

### 3.5 Frontend — Netlify
- The **user** connects the GitHub repo to a new Netlify site (or supplies a Netlify
  personal access token → then the agent runs `npx netlify-cli` itself: `sites:create`,
  `env:set`, `deploy --build --prod`).
- Frontend env var (e.g. `VITE_API_URL`) = the Funnel base URL from §3.4. Netlify env vars
  are set in the site UI or via `netlify env:set KEY value`.
- Auto-deploys on every push to main. Crons, if needed, are Netlify **scheduled
  functions** in the repo (see ApplyPilot's `netlify/functions/daily-run.mjs`).

### 3.6 Zero-touch layer (copy, rename, install)
Copy from `~/Desktop/projects/ApplyPilot-Cloud/selfhost/`, rename `applypilot`→`<name>`:
- **autopull** (5 min): git pull `~/apps/<name>`, install deps if lockfile changed, apply
  new migrations, `launchctl kickstart -k gui/$(id -u)/com.<name>.server` if code changed.
- **watchdog** (5 min): curl the local `/health` AND the public Funnel URL; on failure
  kickstart the server / re-assert the funnel path; ping a healthchecks.io URL when green.
- **backup** (nightly): `pg_dump -d <name>` + tar of `data/`, 14-day retention.
Install with a copy of `install-launchd.sh`. After this, the loop is: **push to GitHub →
laptop converges in ≤5 min, Netlify redeploys the frontend** — nobody touches the laptop.

### 3.7 Verify before declaring done (all four, in order)
1. `curl localhost:<port>/health` on the laptop → `{ok:true}`.
2. `curl https://vamsis-macbook-pro.tail579e6c.ts.net/<name>/health` from anywhere.
3. The Netlify site loads and completes a real end-to-end action against the backend.
4. `launchctl list | grep com.<name>` shows the jobs; kill the server process and watch
   the watchdog resurrect it within 5 minutes.

## 4. Hard-won gotchas (each cost real debugging time)

- **macOS TCC**: launchd jobs silently fail to read the home dir without Full Disk Access
  (no prompt, just `operation not permitted`). `/bin/zsh` and OrbStack already have FDA.
- **xattrs**: supabase-storage-style file backends need extended attributes → named Docker
  volumes, never macOS bind mounts. (Plain `data/` dirs from a native Node/Python process
  are fine.)
- **Port squatters**: other projects' containers autostart with Docker and may hold ports
  (Skyvern holds 8000 on the dev Mac). Always `lsof` before picking.
- **Bind 127.0.0.1 only.** Nothing listens publicly except what Funnel explicitly mounts.
- **Secrets never in git**: `.env` files, generated at deploy time; passwords/tokens are
  pasted by the user when asked, never committed, never echoed into logs.
- **Tailscale CLI**: on the laptop `tailscale` is a wrapper script (symlinks crash the app
  CLI) — call it plainly, don't re-symlink.

## 5. What the human must do (everything else is the agent's job)

1. Create/connect the **Netlify site** (or hand over a Netlify token; revoke after use).
2. Paste **passwords** when prompted: laptop sudo, Postgres superuser (from the laptop's
   ApplyPilot `.env`), any third-party API keys the app needs.
3. Approve anything Tailscale asks in the admin console (rare; Funnel is already enabled).
4. Optional: create healthchecks.io checks for the new app's watchdog/backup pings.
