#!/bin/zsh
set -uo pipefail
BACKEND="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$BACKEND/logs/watchdog.log"
mkdir -p "$BACKEND/logs"
set -a; source "$BACKEND/.env"; set +a
[[ "$APP_NAME" =~ '^[a-z0-9]+$' ]] || exit 64
log() { echo "$(date '+%F %T') $*" >> "$LOG"; }

if ! curl -fsS -m 8 "http://127.0.0.1:${PORT}/health" >/dev/null; then
  log "backend unhealthy; reconciling REST and gateway"
  docker compose --project-name "$APP_NAME" --project-directory "$BACKEND" --env-file "$BACKEND/.env" up -d >> "$LOG" 2>&1 || true
  launchctl kickstart -k "gui/$(id -u)/com.${APP_NAME}.backend" >> "$LOG" 2>&1 || true
fi

if ! curl -fsS -m 8 "http://127.0.0.1:${WORKER_PORT}/health" >/dev/null; then
  log "worker unhealthy; restarting"
  launchctl kickstart -k "gui/$(id -u)/com.${APP_NAME}.worker" >> "$LOG" 2>&1 || true
fi

if ! "$BACKEND/scripts/check-public-funnel.sh" "$PUBLIC_URL/health"; then
  log "public endpoint unhealthy; reasserting Funnel path"
  tailscale funnel --bg --set-path "/${APP_PATH}" "http://127.0.0.1:${PORT}" >> "$LOG" 2>&1 || true
fi
