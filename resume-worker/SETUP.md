# Phase 4 — run the résumé worker on the always-on server laptop + expose it to Netlify

> **Legacy production runbook.** This Cloudflare/Supabase topology is retained for the
> original `main` deployment. For `multi-user-fork`, use
> [`backend/README.md`](../backend/README.md); do not apply these ports, secrets, services,
> or tunnel instructions to the isolated fork.

Goal: the deployed app (Netlify) renders PDFs by calling this worker, which runs on your always-on Mac and is
reachable over a stable HTTPS URL via Cloudflare Tunnel. Do this **on the server laptop**.

## 0. Prereqs
- Node 18+ (`node -v`). If missing: `brew install node`.
- `brew install cloudflared`.
- A domain on Cloudflare (you have `vamsikrish.com`).

## 1. Copy the worker + install
```bash
# copy the resume-worker/ folder to the server laptop (git clone the repo, or scp the folder)
cd resume-worker
npm install                      # downloads headless Chromium (~150 MB), one-time
cp .env.example .env
```
Edit `.env`:
- `WORKER_SECRET` — a long random string. **Use the same value** for `RESUME_WORKER_SECRET` in Netlify (step 5).
  Generate one: `node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"`
- `SUPABASE_URL` — `https://ftrakpebzcabztwyunum.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY` — from Supabase → Project Settings → API (service_role). Server-only.

Smoke-test locally first:
```bash
npm run sample            # writes sample-classic.pdf / sample-modern.pdf — open them
npm start                 # worker on :8787
curl localhost:8787/health
```

## 2. Run the worker on boot (launchd)
```bash
./install-service.sh      # installs ~/Library/LaunchAgents/com.applypilot.resume-worker.plist + starts it
# logs: resume-worker/logs/worker.{out,err}.log ; remove with: ./install-service.sh remove
```

## 3. Create the Cloudflare Tunnel
```bash
cloudflared tunnel login                                  # opens browser; pick vamsikrish.com
cloudflared tunnel create applypilot-worker               # note the Tunnel ID + creds file path
cloudflared tunnel route dns applypilot-worker worker.vamsikrish.com
```
Create `~/.cloudflared/config.yml`:
```yaml
tunnel: applypilot-worker
credentials-file: /Users/<you>/.cloudflared/<TUNNEL_ID>.json
ingress:
  - hostname: worker.vamsikrish.com
    service: http://localhost:8787
  - service: http_status:404
```
Run it on boot:
```bash
sudo cloudflared service install     # launchd service for the tunnel
# or test in the foreground first: cloudflared tunnel run applypilot-worker
```
Verify from anywhere: `curl https://worker.vamsikrish.com/health` → `{"ok":true,"browser":true}`.

## 4. (Recommended) keep the Mac awake
System Settings → Battery/Energy → prevent automatic sleeping when plugged in, or:
`sudo pmset -c sleep 0 disablesleep 1` (on AC). The tunnel + worker only serve while the Mac is awake.

## 5. Point Netlify at the worker
Netlify → Site settings → Environment variables, add:
- `RESUME_WORKER_URL = https://worker.vamsikrish.com`
- `RESUME_WORKER_SECRET = <the same WORKER_SECRET from step 1>`

Redeploy (or it picks them up on the next deploy). Now **Applications → Generate → Create PDF → Download**
works in production.

## 6. (Optional) Claude subscription mode — run AI on your plan, not API tokens (ADR 0042)
Lets scoring / tailoring / etc. run on your Claude Pro/Max subscription via the Agent SDK instead
of a paid API key. The SDK can only run here (it drives the `claude` CLI), so it lives on this worker.
```bash
npm i -g @anthropic-ai/claude-code      # the CLI the Agent SDK drives
claude setup-token                       # opens browser; prints a 1-year OAuth token (sk-ant-oat01-…)
```
Put the token in `.env` as `CLAUDE_CODE_OAUTH_TOKEN=…` (or run `claude login` once and leave it blank),
then restart the worker (`./install-service.sh` reloads it). Verify auth: `claude /status` should show your
subscription. **Do not** set `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` in this worker's env — they override
the subscription and bill the API.

In the app: **Settings → AI Models** → set AI Chat, Tailoring, and/or Everything else to **"Claude
subscription (no API key)"**. Note the plan's monthly Agent-SDK credit cap (Pro $20 · Max5× $100 ·
Max20× $200), then standard API rates — so high-volume scoring is often better left on a cheap model.

### 6a. (Optional) Two Claude accounts — double the monthly credit, with failover
Each Claude plan has its own monthly Agent-SDK credit pool, so a second account doubles the effective cap.
The mechanism (the one Anthropic documents and tools like Meridian use): **each account is an isolated
`CLAUDE_CONFIG_DIR` with its own login** — credentials are stored per-dir (not in the shared macOS Keychain),
so the worker switches accounts just by pointing at a different dir.

Set up the 2nd account once, in a browser, on this Mac:
```bash
CLAUDE_CONFIG_DIR=~/.claude-acct2 claude     # then /login as ACCOUNT 2 (a different Claude account)
```
The worker **auto-detects** `~/.claude-acctN` once it exists. Account 1 keeps using its existing login.
- **Manual switch:** `./switch-account.sh 2` (sets `CLAUDE_ACTIVE_ACCOUNT` + restarts) — or `./switch-account.sh`
  to see status. The active account is tried first.
- **Automatic failover:** if the active account fails *fast* (credit cap / auth / rate limit), the call
  transparently retries on the other account. It does **not** fail over on a *timeout* (a stall), so one
  tailoring call can't blow the app's 180s deadline doing 2×160s.
- Verify a switch in `logs/worker.out.log`: the `[agent …] start … account=N configDir=…` line shows which
  account each call used, and `[agent] account N failed → failing over to account M` shows a failover.

### 6b. (Optional) ChatGPT subscription mode — no OpenAI API key (ADR 0069)
The worker can also run any AI lane through OpenAI's official Codex SDK using the ChatGPT account's Codex
entitlement. The SDK and its pinned CLI are installed by `npm install`; authenticate it once on this Mac:

> `multi-user-fork` users do not run these shared-login commands. Each user opens
> **Settings → ChatGPT connection** and completes the official device-code flow; the fork
> stores that login under `backend/data/chatgpt-users/<uuid>/` (ADR 0081). The commands
> below are only for the legacy single-owner deployment.

```bash
cd /absolute/path/to/ApplyPilot-Cloud/resume-worker
mkdir -p "$HOME/.applypilot-codex"
CODEX_HOME="$HOME/.applypilot-codex" ./node_modules/.bin/codex login
CODEX_HOME="$HOME/.applypilot-codex" ./node_modules/.bin/codex login status
```

Add the absolute path to `.env` (dotenv does not expand `$HOME`), then restart the worker:

```bash
CHATGPT_CODEX_HOME=/Users/<you>/.applypilot-codex
launchctl kickstart -k gui/$(id -u)/com.applypilot.resume-worker
```

In **Settings → AI Models**, choose **ChatGPT subscription (no API key)** independently for AI Chat,
Tailoring, or Everything else. `gpt-5.4` is the conservative default; a smaller model is better for
high-volume scoring. The model dropdown keeps a Custom option because Codex model access can vary by plan.

The worker strips `OPENAI_API_KEY`, `CODEX_API_KEY`, and base-URL overrides from the Codex subprocess. It
runs in an empty read-only directory with network, web search, MCP, approvals, project instructions, and
session persistence disabled. Cached-input tokens are normalized into the same usage fields as Claude.
A positive `cacheRead` in the worker log confirms a stable-prefix hit; zero is a valid miss (or a prefix
below the provider threshold), so verify across a real multi-job batch rather than a tiny health prompt.

## Security notes
- The worker only accepts requests with `Authorization: Bearer <WORKER_SECRET>`; it refuses to run if
  `WORKER_SECRET` is unset.
- `.env` and `logs/` are gitignored — never commit them. The service_role key lives only on this machine + Netlify.
- The Cloudflare Tunnel is outbound-only (no inbound ports opened on your network/router).

## Troubleshooting
- `curl https://worker.vamsikrish.com/health` fails → check `cloudflared` is running and the DNS route exists.
- App says "Could not reach the résumé worker" → `RESUME_WORKER_URL`/`SECRET` mismatch, or the Mac is asleep.
- PDF render fails → see `logs/worker.err.log`; ensure `npm install` finished downloading Chromium.
- ChatGPT subscription says not logged in → run the two `CODEX_HOME=... codex login/status` commands in
  §6b as the same macOS user that owns the launchd worker, then restart it.
