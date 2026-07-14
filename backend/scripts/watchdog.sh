#!/bin/zsh
set -uo pipefail
BACKEND="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$BACKEND/logs/watchdog.log"
mkdir -p "$BACKEND/logs"
set -a; source "$BACKEND/.env"; set +a
log() { echo "$(date '+%F %T') $*" >> "$LOG"; }

if ! curl -fsS -m 8 "http://127.0.0.1:${PORT}/health" >/dev/null; then
  log "backend unhealthy; reconciling REST and gateway"
  docker compose --project-directory "$BACKEND" --env-file "$BACKEND/.env" up -d >> "$LOG" 2>&1 || true
  launchctl kickstart -k "gui/$(id -u)/com.jobpilotmulti.backend" >> "$LOG" 2>&1 || true
fi

if ! curl -fsS -m 8 "http://127.0.0.1:${WORKER_PORT}/health" >/dev/null; then
  log "worker unhealthy; restarting"
  launchctl kickstart -k "gui/$(id -u)/com.jobpilotmulti.worker" >> "$LOG" 2>&1 || true
fi

if ! curl -fsS -m 12 "$PUBLIC_URL/health" >/dev/null; then
  log "public endpoint unhealthy; reasserting Funnel path"
  tailscale funnel --bg --set-path "/${APP_PATH}" "http://127.0.0.1:${PORT}" >> "$LOG" 2>&1 || true
fi
