# Running & updating the résumé worker on the server laptop

This is the runbook for the **always-on server laptop** that hosts the ApplyPilot-Cloud
résumé worker (`resume-worker/`) — the Node + Puppeteer service the deployed app calls
over a Cloudflare tunnel to **tailor résumés, render PDFs, and generate cover letters**.

> Running Claude Code here? You can just say **"follow resume-worker/DEPLOY.md"** and let
> it do the steps below. It's install-and-restart only — never change app code or the
> database from this machine.

The web app itself runs on Netlify. This machine's only job is to keep the **worker** and
its **tunnel** healthy and on the latest code.

---

## 1. Standard update (after a push from the dev laptop)

Run these every time new code is pushed to `main`:

```bash
# repo lives here (adjust if yours differs):
cd ~/Desktop/projects/ApplyPilot-Cloud

git pull                                   # get the latest worker code
git log --oneline -1                       # note what you're now on

npm install --prefix resume-worker         # install any new deps (e.g. `ws`)

# restart the worker so the new code loads (launchd label below):
launchctl kickstart -k gui/$(id -u)/com.applypilot.resume-worker
```

That's it. Then verify (section 3). The Cloudflare tunnel
(`com.applypilot.resume-tunnel`) keeps running on its own and re-publishes its public URL
to Supabase `settings.resume_worker_url`; you normally don't touch it.

---

## 1a. THIS UPDATE — overnight tailoring queue + auto-pipeline (ADR 0043 / 0044)

This release adds two things that affect the server laptop:

- **Overnight tailoring queue** — the worker can drain the Tailor & Apply queue on a schedule
  (e.g. 04:00): tailor + score + render a PDF for every `queued` application. The web app is on
  Netlify (no Vercel cron), so **this machine owns the schedule** via a new launchd job.
- **Auto-pipeline** — runs entirely in the cloud app; nothing to install here. The worker only
  needs the standard `git pull` + restart so its `/tailor-queue` endpoint exists.

Do the standard update in section 1 first (`git pull` → `npm install --prefix resume-worker`
→ restart the worker). `npm install` is a no-op this time — **no new dependencies** were added.
Then install the **one new launchd job** that fires the overnight queue (one-time):

```bash
cd ~/Desktop/projects/ApplyPilot-Cloud/resume-worker     # adjust path if yours differs

./install-tailor-queue-cron.sh                # installs + starts com.applypilot.tailor-queue
```

That job fires **hourly at :00** and pings the local worker; the worker no-ops unless the
current hour matches `auto_tailor_time` and `auto_tailor_enabled` is on (both set in the web
app under **Settings → Daily Schedule**) — so the web UI stays the source of truth for the time.

**Keep the laptop awake.** launchd only fires while the Mac is awake; if it sleeps at 4am the run
is *deferred* until it next wakes (not skipped, but not at 4am). You said this machine never
sleeps — confirm with `pmset -g | grep -E 'sleep|SleepDisabled'` (sleep should be `0`). If it can
sleep, either disable sleep (System Settings → Battery/Lock Screen) or add a wake schedule:

```bash
sudo pmset repeat wakeorpoweron MTWRFSU 03:58:00     # wake ~2 min before a 04:00 run
```

Verify the cron job is loaded and test the trigger:

```bash
launchctl list | grep applypilot                      # expect com.applypilot.tailor-queue listed
bash ./tailor-queue-trigger.sh                         # fires the scheduled path once now
tail -n 5 logs/tailor-queue.out.log                    # see the result line
#  → "...skipped...not the scheduled hour..."  ✅ working (it's not 4am, so it correctly no-ops)
#  → "...processing N..."                        ✅ it IS the scheduled hour and drained N
#  → "curl failed (worker down?)"                ⇒ worker not running — see section 2
```

To re-run the whole queue **right now** regardless of schedule, use the **Run queue now** button
in the web app (Tailor & Apply) — that hits the worker's manual path and bypasses the hour gate.

> ⚠️ **Database migrations are NOT applied from this machine.** ADR 0043/0044 added Supabase
> columns; those are applied from the dev laptop. This machine only pulls code and restarts.

---

## 2. If the worker isn't running at all (first-time / after a reboot problem)

The launchd services should auto-start on boot. If they're missing, (re)install them from
the worker folder:

```bash
cd ~/Desktop/projects/ApplyPilot-Cloud/resume-worker
npm install                                # one-time: also downloads headless Chromium (~150 MB)
# ensure .env exists with WORKER_SECRET + SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
./install-service.sh                       # installs + starts com.applypilot.resume-worker
./install-tunnel-service.sh                # installs + starts com.applypilot.resume-tunnel
./install-tailor-queue-cron.sh             # installs + starts com.applypilot.tailor-queue (overnight queue)
```

Full first-time setup (tunnel DNS, Netlify env, etc.) is in `resume-worker/SETUP.md`.

---

## 3. Verify it's healthy (do this after every update)

```bash
# a) health — expect {"ok":true,"browser":true}. browser:false ⇒ Chromium isn't launching.
curl -s localhost:8787/health; echo

# b) Supabase works — the real test. An authed call with a dummy id should return
#    404 "application not found", which proves the Supabase client constructed and
#    queried WITHOUT throwing (this is what the Node-20 WebSocket bug broke).
SECRET=$(grep -E '^WORKER_SECRET=' resume-worker/.env | cut -d= -f2-)
curl -s -w '\nHTTP %{http_code}\n' -X POST \
  -H "Authorization: Bearer $SECRET" -H "Content-Type: application/json" \
  -d '{"id":"00000000-0000-0000-0000-000000000000"}' \
  localhost:8787/cover-letter
#  → {"error":"application not found"} + HTTP 404  ✅ healthy
#  → HTTP 401                                       ⇒ WORKER_SECRET mismatch
#  → HTTP 404 "Cannot POST /cover-letter"           ⇒ stale code; the restart didn't take

# c) logs — confirm no errors (especially no "Node.js 20 detected ... WebSocket").
tail -n 40 resume-worker/logs/worker.err.log
```

Final smoke test from the **deployed app**: Tailor & Apply → open an application →
**Generate** (résumé) and **Cover letter** → both should download a PDF.

---

## 4. Reference

| Thing | Value |
|---|---|
| Worker launchd label | `com.applypilot.resume-worker` (port **8787**) |
| Tunnel launchd label | `com.applypilot.resume-tunnel` (publishes URL → Supabase `settings.resume_worker_url`) |
| Tailor-queue cron label | `com.applypilot.tailor-queue` (hourly trigger for the overnight queue, ADR 0043) |
| Restart worker | `launchctl kickstart -k gui/$(id -u)/com.applypilot.resume-worker` |
| Restart tunnel | `launchctl kickstart -k gui/$(id -u)/com.applypilot.resume-tunnel` |
| Reinstall tailor cron | `./install-tailor-queue-cron.sh` (or `./install-tailor-queue-cron.sh remove`) |
| Worker logs | `resume-worker/logs/worker.{out,err}.log` |
| Tunnel logs | `resume-worker/logs/tunnel.{out,err}.log` |
| Tailor-queue log | `resume-worker/logs/tailor-queue.out.log` (one line per hourly tick) |
| Health | `GET http://localhost:8787/health` → `{ ok, browser }` |
| Endpoints | `POST /tailor`, `POST /generate`, `POST /cover-letter`, `POST /tailor-queue` (all need `Authorization: Bearer <WORKER_SECRET>`) |

---

## 5. Troubleshooting

- **`Node.js 20 detected without native WebSocket support` (RealtimeClient)** — the Supabase
  client needs a WebSocket; Node < 22 has none. The code already polyfills it from the `ws`
  package (`resume-worker/supabase.js`). If you still see this, `node_modules` is stale: run
  `npm install --prefix resume-worker` then restart. (Or run the worker on Node 22+, which has
  a native WebSocket.)
- **`/health` shows `browser:false`** — Chromium failed to launch. Check
  `resume-worker/logs/worker.err.log`; a reinstall (`npm install --prefix resume-worker`,
  which re-downloads Chromium) usually fixes it.
- **`/cover-letter` (or `/tailor`) returns 404 "Cannot POST …"** — the running process is on old
  code. The restart didn't pick up the pull; re-run the kickstart, and confirm the launchd plist
  points at this repo (`ProgramArguments` → `…/resume-worker/server.js`).
- **App can't reach the worker** — make sure the tunnel service is running
  (`launchctl list | grep applypilot`) and that `settings.resume_worker_url` matches the tunnel's
  current public URL (the tunnel republishes it on start; restart the tunnel if needed).
- **Overnight queue didn't run at 4am** — check, in order: (1) `auto_tailor_enabled` is on and
  `auto_tailor_time` is correct in Settings; (2) the cron job is loaded
  (`launchctl list | grep com.applypilot.tailor-queue`); (3) the laptop was awake at that hour
  (`pmset -g log | grep -i wake` around 04:00); (4) `logs/tailor-queue.out.log` for the tick at
  that hour. A line saying `skipped … not the scheduled hour` at other hours is normal. If the
  job is missing from `launchctl list`, re-run `./install-tailor-queue-cron.sh`.
- **`POST /tailor-queue` returns 404 "Cannot POST …"** — same as the `/tailor` case above: the
  worker is on old code. Re-pull and `launchctl kickstart -k` the worker.
