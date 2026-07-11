# Plan: replace Supabase cloud with the server laptop (self-hosted)

**Date:** 2026-07-11 · **Status: accepted — phase 0 built & validated** (bundle
in `selfhost/`, runbook in `selfhost/SETUP-SELFHOST.md`; phases 1–3 pending)

## Verdict up front

Feasible and a good fit for this app, with eyes open. Capacity is a non-issue: the entire
database is 48 MB, storage is 226 MB, one user. Any laptop is overkill. What you're really
taking on is **operations** — exposure, uptime, backups — and all three can be automated to
the "never touch it" standard asked for. The honest trade-off: today, if the server laptop
dies, only tailoring/PDFs stop; after this move, **the whole app is down until the laptop
recovers** (recovery is automated for the common failures, but Wi-Fi/hardware are now in the
serving path of every page load).

## What the app actually uses (verified in code, 2026-07-11)

| Supabase feature | Used? | Evidence |
|---|---|---|
| PostgREST (REST over `supabase-js`) | ✅ everywhere | all `lib/` + `app/api/` data access |
| Storage | ✅ small surface | `resumes` bucket: 2 PDF proxy routes + worker uploads |
| Auth (GoTrue) | ❌ | custom password cookie (`lib/auth.ts`, `middleware.ts`) |
| Realtime | ❌ | only a `ws` transport polyfill so the client constructs (`resume-worker/supabase.js:13-16`) |
| Edge Functions | ❌ | Netlify functions instead |
| RLS | ❌ (disabled on all tables) | verified via `pg_class.relrowsecurity` |

Consequence: **zero app-code changes needed.** Self-hosted Supabase keeps the same
`/rest/v1` + `/storage/v1` API behind one gateway; the app just gets a new
`SUPABASE_URL` + freshly generated keys. (A later, optional leaning-out — plain `pg` +
files on disk — is possible precisely because Auth/Realtime/RLS are unused, but it's a
rewrite of every query; do not start there.)

## Prior art (researched 2026-07-11)

- **Official self-hosted Docker Compose** — [supabase.com/docs/guides/self-hosting/docker](https://supabase.com/docs/guides/self-hosting/docker),
  [compose file](https://github.com/supabase/supabase/blob/master/docker/docker-compose.yml).
  ~13 services behind Kong on port 8000; guidance: 4 GB RAM min, generate real
  JWT secret + anon/service keys before first boot, never expose individual service
  ports — only the gateway.
- **[singh-inder/supabase-automated-self-host](https://github.com/singh-inder/supabase-automated-self-host)** —
  the community's one-script setup (Caddy/Nginx + optional Authelia 2FA). Linux/WSL-only,
  so we can't run the script on macOS, but it's the best reference for which knobs matter
  (gateway config, dashboard lockdown, key generation).
- **[Tailscale Funnel](https://tailscale.com/docs/features/tailscale-funnel)** — exposes one
  HTTPS port publicly at a stable `https://<machine>.<tailnet>.ts.net` hostname with
  managed certs, no port-forwarding, no DNS changes. Undisclosed but generous bandwidth
  (community reports streaming 4K through it); fine for a single-user REST API. This
  matters because our DNS zone lives on Netlify DNS, so Cloudflare *named* tunnels (which
  require the zone on Cloudflare) would force a DNS migration — Funnel avoids that
  entirely. The existing worker quick-tunnel URL churn (`settings.resume_worker_url`)
  also goes away if the worker moves behind the same stable hostname later.

## Target architecture

```
Netlify app (unchanged code)                Server laptop (macOS, always on)
  SUPABASE_URL=https://<machine>.ts.net ──► Tailscale Funnel (443, stable hostname, TLS)
                                              └─► Kong :8000 (only public entry)
Worker Mac worker (same laptop)                    ├─► PostgREST  /rest/v1
  SUPABASE_URL=http://localhost:8000 ──────────────├─► storage-api /storage/v1 (files on disk)
                                                   └─► (Studio kept LAN/tailnet-only)
Dev Mac (this machine)                        Postgres :5432 — tailnet-only, never public
  psql/migrations over Tailscale ────────────►    volumes bind-mounted under ~/applypilot-db/
```

Trimmed from the official compose once green: analytics/logflare + vector (heaviest
services), realtime, edge-functions, imgproxy — none are used. Postgres image version
**pinned**; no auto-updates of the database, ever.

## The "never touch it" layer (all launchd, all installed by script)

1. **Boot resilience** — auto-login on, FileVault off, `pmset` never sleep (already the
   worker-Mac standard), macOS auto-updates set to download-only. OrbStack (or Docker
   Desktop) set to start at login; all containers `restart: always`.
2. **Auto-deploy** — `com.applypilot.autopull` every 5 min: `git fetch`; if `main` moved →
   pull, `npm install --prefix resume-worker` when its lockfile changed, kickstart worker,
   and **auto-apply new `supabase/migrations/*.sql`** against local Postgres, recording
   each in a `schema_migrations` table so they run exactly once. Result: push from the dev
   Mac → laptop converges within 5 minutes, code *and* schema.
3. **Watchdog** — every 5 min: probe Kong (`/rest/v1/`, expect an auth challenge), worker
   `/health`, and Funnel reachability; on consecutive failures restart the offending layer
   (compose service / worker / funnel). Every success pings a free
   [healthchecks.io](https://healthchecks.io) check — if pings *stop* (power, Wi-Fi, disk
   death), you get an email. That converts "silently down for days" into "email within
   ~10 minutes."
4. **Backups** — nightly `pg_dump | gzip` (DB is 48 MB → dumps are a few MB) + weekly
   rsync of the storage files, kept 14 days locally **and** copied to a second location
   (Decision C: iCloud Drive folder = zero new accounts, or Backblaze B2 free tier).
   Backup success pings its own healthcheck — a backup that stops happening alerts.
5. **Remote hands** — Tailscale SSH from the dev Mac. This is what makes "you never touch
   it" true: after the one-time bootstrap, all deploys, debugging, restores, and upgrades
   happen from the dev machine (Claude included) over the tailnet.

## Migration & cutover (phased; storage is gated by the egress restriction)

- **Phase 0 — build & validate on the dev Mac (no risk, start anytime).** Add a
  `selfhost/` bundle to this repo: compose + `.env` template + key generation + the four
  launchd plists + scripts (autopull, watchdog, backup, migrate) + `SETUP-SELFHOST.md`.
  Bring the stack up locally, restore a fresh `pg_dump` of prod (direct psql still works
  despite the API restriction), point `npm run dev` at it, and click through the whole
  app. Everything is proven before the laptop is involved.
- **Phase 1 — one-time bootstrap on the server laptop (~20–30 min, the only hands-on
  step).** Install OrbStack + Tailscale, sign in, enable Tailscale SSH, auto-login.
  From then on the dev Mac drives everything.
- **Phase 2 — deploy remotely.** Stand up the stack, restore the dump, enable Funnel,
  install the launchd layer, then flip Netlify env (`SUPABASE_URL` + new keys) and
  redeploy. Single user → a brief cutover blip is acceptable; env rollback is the escape
  hatch. Jobs/scoring/dashboard now run on the laptop DB. PDFs regenerate into local
  storage from day one.
- **Phase 3 — storage backfill + decommission (after ~Jul 17 reset or a one-month Pro).**
  The 226 MB of existing PDFs can only leave Supabase through the Storage API, which is
  egress-restricted until then. Sync `resumes` → local storage, take a final dump,
  export-and-delete the cloud project. The leaked credentials die with it.

## Risks, stated plainly

- **Single point of failure:** laptop down ⇒ app fully down (today: only tailoring down).
  Automated recovery covers crashes/reboots/power blips; it does not cover hardware death
  or multi-hour Wi-Fi outages. Ethernet strongly recommended over Wi-Fi.
- **Latency:** every query now travels Netlify (AWS) → Funnel relay → home network.
  Expect pages to feel slightly slower (~50–150 ms per round-trip vs ~10–30 ms). Fine for
  one user; noticeable on chatty pages until we batch their queries.
- **macOS is the road less traveled** for headless Docker (prior-art scripts are Linux).
  Mitigation: OrbStack-at-login + launchd, patterns already proven on this very laptop by
  the worker stack.
- **The daily pipeline's write path** (Apify webhook → Netlify → laptop) gains the same
  home-network dependency; a nightly outage skips that day's fetch until the watchdog
  restores service and a manual/next-day run catches up.

## Cost

$0/month recurring (Tailscale, OrbStack personal, healthchecks.io free tiers) vs $25/month
Supabase Pro. One-time: the build (Phase 0–2) and the phase-3 backfill window.

## Decisions needed before Phase 0 starts

- **A. Go/no-go** on self-hosting vs just upgrading to Pro ($25/mo buys 250 GB egress and
  zero ops).
- **B. Ingress:** Tailscale Funnel (recommended: zero DNS changes) vs moving
  `vamsikrish.com` DNS to Cloudflare for a named tunnel + custom hostname.
- **C. Backup second location:** iCloud Drive (zero setup) vs Backblaze B2 (cleaner
  separation).
- **D. Bootstrap session:** a ~30-min window where the server laptop gets OrbStack +
  Tailscale + SSH enabled (screen-share or in person), after which it's hands-off.
