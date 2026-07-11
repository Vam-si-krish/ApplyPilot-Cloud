# DAY 13 — 2026-07-11 (server laptop)

## ✅ Self-hosting phases 1–2 executed — the app now runs off the server laptop

Session ran on the **server laptop** (Claude Code driving, user supplying
passwords/clicks per `selfhost/SETUP-SELFHOST.md`). Every "done means verified"
gate passed:

| Gate | Result |
|---|---|
| `docker compose ps` all healthy | ✅ all 7 containers (db, kong, auth, rest, storage, meta, studio) |
| Restore row counts | ✅ jobs=4072, applications=618, settings=1, profile=1 — exact |
| Funnel URL serves `/rest/v1/jobs` with anon key from public internet | ✅ HTTP 200 (proven from outside the tailnet: Netlify functions query through it) |
| Live site shows data after Netlify flip | ✅ logged in, `/api/stats` → 3697 active / 3680 scored / 604 applied |
| Worker on localhost | ✅ `resume-worker/.env` → `http://127.0.0.1:8000`; dummy-id probe returns the healthy `404 application not found`; egress error gone |
| Zero-touch launchd jobs | ✅ all four exit 0; watchdog fail counter 0; test backup produced a real 8.5 MB dump |

### Phase 1 (bootstrap)
- OrbStack installed via brew, `app.start_at_login true` (set via `orb config`, no GUI needed).
- Tailscale installed (pkg via brew cache + `installer`); machine is
  `vamsis-macbook-pro.tail579e6c.ts.net`; user signed in and approved Funnel for the tailnet.
- Remote Login: `systemsetup -setremotelogin on` fails without Full Disk Access —
  enabled sshd directly instead: `sudo launchctl enable system/com.openssh.sshd`
  + `bootstrap system /System/Library/LaunchDaemons/ssh.plist`. Port 22 verified open.
- `pmset -a sleep 0 disablesleep 1` + `pmset repeat wakeorpoweron MTWRFSU 03:25:00`.
- Software Update: `AutomaticallyInstallMacOSUpdates=false` (download only).
- FileVault OFF via `fdesetup disable -inputplist` (no GUI). Auto-login: `sysadminctl
  -autologin set` **hangs** from a non-GUI session — wrote `/etc/kcpassword` +
  `autoLoginUser` default directly instead (same mechanism System Settings uses).
- Worker updated per `resume-worker/DEPLOY.md` §1 to `665fada`, verified healthy.

### Phase 2 (stand up + cut over)
- `bootstrap.sh` clean run: secrets generated, images pulled, stack healthy,
  Funnel enabled on Kong :8000, four launchd jobs installed.
- Funnel URL written into `selfhost/.env` (`SUPABASE_PUBLIC_URL`,
  `API_EXTERNAL_URL`, `SITE_URL`) + recreate.
- `restore-from-cloud.sh` (host needed `brew install libpq` for `pg_dump` — not
  preinstalled on the server laptop): 33 MB dump, counts exact, `resumes` bucket created.
- Netlify flip done via API with a user-supplied token (site `applypilot-cloud`):
  the three env vars set, redeploy triggered, deploy `ready` in ~2 min. **Old cloud
  env values saved to `selfhost/backups/netlify-env-rollback-20260711.json`
  (gitignored)** — rollback = restore those + redeploy.

### New gotchas (server laptop) — added to SETUP-SELFHOST.md
1. **macOS TCC silently blocks launchd jobs from reading `~/Desktop`** — watchdog/
   autopull/backup died (exit 127 `can't open input file`, then `operation not
   permitted` on `.env`) with **no permission prompt**. Fix: System Settings →
   Privacy & Security → **Full Disk Access** → add `/bin/zsh` (⌘⇧G in the picker)
   **and `/Applications/OrbStack.app`** (docker has its own TCC identity). The
   resume-worker job only ever worked because `node` already had a grant.
2. Granting OrbStack FDA **restarts OrbStack** → docker socket vanished, stack
   down ~2 min. Watchdog/stack jobs recover it, but expect the blip.
3. **Tailscale app CLI crashes if symlinked** (`bundleIdentifier is unknown to the
   registry`) — `/opt/homebrew/bin/tailscale` is now a wrapper script that `exec`s
   `/Applications/Tailscale.app/Contents/MacOS/Tailscale "$@"`. Scripts calling
   bare `tailscale` depend on it.

### DAY-12 pending items — status
1. ~~Restore Supabase service~~ → **moot**: serving path no longer touches the cloud API.
2. Evict the squatter bucket (`neha-portfolio`) → **still pending**, must happen
   before the cloud project is deleted in phase 3.
3. ~~Rotate credentials~~ → superseded: the self-hosted stack has **fresh keys**;
   the leaked cloud creds die when the project is deleted (phase 3).
4. ~~Worker Mac redeploy~~ → **done** (`665fada`, verified).
5. Drain the 96 unscored jobs → open (17 remain unscored per `/api/stats`); stale
   `running` runs still unmarked.

### Open items
- **Phase 3 (~Jul 17)**: `sync-storage-files.sh` PDF backfill (~226 MB), final cloud
  `pg_dump`, move/delete `neha-portfolio`, then delete cloud project
  `ftrakpebzcabztwyunum`. Until then old PDF downloads 404 (new ones land locally).
- **healthchecks.io**: the three `HC_PING_*` URLs are still unset — machine death is
  currently silent. Recommended next touch.
- **Second backup destination**: iCloud Drive is NOT signed in on the server laptop;
  dumps exist only in `selfhost/backups/`. Sign in or set `BACKUP_DEST2`.
- **Revoke the Netlify personal access token** used for the flip (pasted in the
  session transcript), and consider rotating the macOS admin password + app
  password for the same reason.
