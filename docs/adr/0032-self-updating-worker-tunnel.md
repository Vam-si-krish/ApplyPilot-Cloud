# ADR 0032 — Self-updating worker tunnel (fix the recurring 502)

## Status
Accepted (2026-06-23)

## Context
The deployed app (Netlify) reaches the always-on Mac's résumé worker over a Cloudflare
**quick tunnel** (`cloudflared tunnel --url http://localhost:8787`). Quick tunnels mint a
**new random `*.trycloudflare.com` URL on every (re)start**, and the app's
`settings.resume_worker_url` was set by hand. So any tunnel restart (reboot, crash, manual
restart) silently pointed the app at a dead URL → `POST /api/applications/[id]/generate`
returned **502** ("could not reach the worker"). This had recurred multiple times.

The "proper" alternative — a Cloudflare **named** tunnel on a stable hostname
(`worker.vamsikrish.com`) — is blocked: `vamsikrish.com`'s authoritative DNS is **Netlify
(NS1)**, not Cloudflare, so `cloudflared tunnel route dns` writes into an inactive Cloudflare
zone that never resolves, and Cloudflare's free tier won't issue an edge cert for a hostname
whose zone isn't on Cloudflare. Making that work would require moving the domain's DNS to
Cloudflare (a registrar-level change affecting the live app) — out of proportion to the need.

## Decision
Remove the manual step instead of chasing a stable hostname. A small wrapper
(`resume-worker/tunnel.mjs`) owns the quick tunnel and **publishes its current URL into the
app's settings automatically**:

1. spawn `cloudflared tunnel --url http://localhost:<PORT> --config /dev/null`
   (the `--config /dev/null` stops a stray `~/.cloudflared/config.yml` from hijacking
   quick-tunnel routing — a 404 trap hit during this session),
2. parse the `https://<random>.trycloudflare.com` URL it prints,
3. `PATCH settings (id=1) { resume_worker_url }` via Supabase REST using the worker's own
   `.env` (`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`) — the app prefers this DB value over
   its env var, so it takes effect immediately with no redeploy,
4. restart cloudflared if it exits and re-publish the new URL.

Both the worker and this tunnel run as **launchd LaunchAgents** (`com.applypilot.resume-worker`
via `install-service.sh`; `com.applypilot.resume-tunnel` via the new
`install-tunnel-service.sh`) with `RunAtLoad` + `KeepAlive`, so they start on boot and
self-heal on crash.

## Consequences
- The 502-from-stale-URL class of failure is **gone**: whenever the tunnel (re)starts, the app
  is repointed within ~1s. No human ever edits `settings.resume_worker_url` again.
- Survives reboots and crashes (launchd KeepAlive on both services).
- The public URL is still ephemeral and only valid while the Mac is awake + logged in — quick
  tunnels carry no uptime guarantee. If a stable hostname is ever wanted, the durable path is
  moving `vamsikrish.com` DNS to Cloudflare and using the named `applypilot-worker` tunnel
  (already created: id `b4b58cb2-…`) — deferred as not worth the DNS migration today.
- The tunnel writes to the production `settings` row using the service-role key already on the
  Mac (RLS-bypassing, as the worker already does). Only `resume_worker_url` is touched.
- Putting the worker under launchd also activated the latest worker code (ADR 0031 one-page
  condense loop + the clickable-contact-links template change) that had been running ad-hoc.
