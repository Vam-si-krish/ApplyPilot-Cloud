#!/usr/bin/env bash
#
# Hourly trigger for the overnight tailoring queue (ADR 0043). Run ON the always-on
# Worker Mac by launchd (see install-tailor-queue-cron.sh). The app is on Netlify, where
# vercel.json crons do NOT fire — so the schedule lives here instead.
#
# It pings the LOCAL worker's /tailor-queue with `scheduled:true`. The worker self-gates
# on the DB Settings (auto_tailor_enabled + auto_tailor_time in the user's timezone), so
# firing hourly is fine: 23 of every 24 calls no-op, and the one at the configured hour
# drains the queue. That keeps the Settings UI the single source of truth for the time —
# change it on the web, no need to touch this machine.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$DIR/.env"
[ -f "$ENV_FILE" ] || { echo "no .env at $ENV_FILE"; exit 1; }

# Pull PORT + WORKER_SECRET from the worker's own .env (don't hardcode the secret).
PORT="$(grep -E '^PORT=' "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '"' || true)"
SECRET="$(grep -E '^WORKER_SECRET=' "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '"' || true)"
PORT="${PORT:-8787}"
[ -n "$SECRET" ] || { echo "WORKER_SECRET not set in $ENV_FILE"; exit 1; }

ts="$(date '+%Y-%m-%d %H:%M:%S')"
resp="$(curl -fsS -m 25 -X POST "http://localhost:${PORT}/tailor-queue" \
  -H "Authorization: Bearer ${SECRET}" \
  -H 'Content-Type: application/json' \
  -d '{"scheduled":true}' 2>&1 || echo '{"error":"curl failed (worker down?)"}')"

# One log line per hourly tick (the launchd plist appends this to a log file).
echo "[$ts] tailor-queue trigger → $resp"
