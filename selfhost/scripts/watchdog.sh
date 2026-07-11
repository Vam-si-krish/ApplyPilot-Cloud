#!/bin/zsh
# Self-healing probe: runs every 5 min via launchd (com.applypilot.selfhost.watchdog).
# Checks the real serving path (Kong -> PostgREST -> Postgres), the worker, and the
# public Funnel URL. Restarts the failing layer; pings healthchecks.io when green
# (so a dead machine = missed pings = alert email).
set -uo pipefail

SH="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$SH/logs/watchdog.log"
STATE="$SH/logs/watchdog.fails"
mkdir -p "$SH/logs"
log() { echo "$(date '+%F %T') $*" >> "$LOG"; }

ANON_KEY=$(grep -E '^ANON_KEY=' "$SH/.env" | cut -d= -f2-)
PUBLIC_URL=$(grep -E '^SUPABASE_PUBLIC_URL=' "$SH/.env" | cut -d= -f2-)
KONG_PORT=$(grep -E '^KONG_HTTP_PORT=' "$SH/.env" | cut -d= -f2-); KONG_PORT=${KONG_PORT:-8000}
HC=$(grep -E '^HC_PING_WATCHDOG=' "$SH/.env" | cut -d= -f2-)

probe() { curl -fsS -m "${2:-8}" -H "apikey: $ANON_KEY" "$1/rest/v1/jobs?select=id&limit=1" >/dev/null 2>&1; }

FAILS=0
NOTES=""

# 1) local stack through Kong
if ! probe "http://127.0.0.1:$KONG_PORT"; then
  NOTES+="local-api "
  log "local API probe failed — docker compose up -d + restart kong/rest/storage"
  ( cd "$SH" && docker compose up -d >> "$LOG" 2>&1 && docker compose restart kong rest storage >> "$LOG" 2>&1 )
  FAILS=1
fi

# 2) resume worker
if ! curl -fsS -m 5 http://127.0.0.1:8787/health >/dev/null 2>&1; then
  NOTES+="worker "
  log "worker probe failed — kickstart"
  launchctl kickstart -k "gui/$(id -u)/com.applypilot.resume-worker" >> "$LOG" 2>&1 || true
  FAILS=1
fi

# 3) public Funnel path (only meaningful when PUBLIC_URL is a ts.net hostname)
if [[ "$PUBLIC_URL" == https://*ts.net* ]]; then
  if ! probe "$PUBLIC_URL" 12; then
    NOTES+="funnel "
    log "funnel probe failed — re-asserting funnel"
    tailscale funnel --bg "$KONG_PORT" >> "$LOG" 2>&1 || true
    FAILS=1
  fi
fi

# escalation: 3 consecutive all-red rounds => full stack bounce
if [[ $FAILS -eq 1 ]]; then
  N=$(( $(cat "$STATE" 2>/dev/null || echo 0) + 1 )); echo "$N" > "$STATE"
  log "unhealthy ($NOTES) — consecutive failures: $N"
  if [[ $N -ge 3 ]]; then
    log "3 consecutive failures — full compose bounce"
    ( cd "$SH" && docker compose down >> "$LOG" 2>&1; docker compose up -d >> "$LOG" 2>&1 )
    echo 0 > "$STATE"
  fi
else
  echo 0 > "$STATE"
  [[ -n "${HC:-}" ]] && curl -fsS -m 10 "$HC" >/dev/null 2>&1 || true
fi
exit 0
