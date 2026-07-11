#!/bin/zsh
# Zero-touch deploy: runs every 5 min via launchd (com.applypilot.selfhost.autopull).
# If origin/main moved: pull, install worker deps when needed, restart the worker,
# and apply any new supabase/migrations/*.sql exactly once (tracked in
# public.schema_migrations). The dev Mac pushes; this machine converges.
set -euo pipefail

REPO_DIR="${REPO_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
SH="$REPO_DIR/selfhost"
LOG="$SH/logs/autopull.log"
mkdir -p "$SH/logs"
log() { echo "$(date '+%F %T') $*" >> "$LOG"; }

# single-flight lock
LOCK=/tmp/applypilot-autopull.lock
if ! mkdir "$LOCK" 2>/dev/null; then exit 0; fi
trap 'rmdir "$LOCK"' EXIT

cd "$REPO_DIR"
git fetch origin main --quiet
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)

apply_migrations() {
  # host psql may not exist on the server laptop — use the db container's.
  local PSQL=(docker compose --project-directory "$SH" exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q)
  "${PSQL[@]}" -c "create table if not exists public.schema_migrations (filename text primary key, applied_at timestamptz not null default now());" >/dev/null
  local applied f base
  applied=$("${PSQL[@]}" -tAc "select filename from public.schema_migrations;")
  for f in "$REPO_DIR"/supabase/migrations/*.sql(N); do
    base=$(basename "$f")
    if ! grep -qx "$base" <<< "$applied"; then
      log "applying migration $base"
      "${PSQL[@]}" -1 -f - < "$f" >> "$LOG" 2>&1
      "${PSQL[@]}" -c "insert into public.schema_migrations (filename) values ('$base');" >/dev/null
    fi
  done
}

if [[ "$LOCAL" == "$REMOTE" ]]; then
  # No code changes; still reconcile migrations once a day-ish is unnecessary —
  # they were applied when their commit arrived. Exit quietly.
  exit 0
fi

log "updating $LOCAL -> $REMOTE"
git pull --ff-only origin main --quiet

CHANGED=$(git diff --name-only "$LOCAL" HEAD)

if grep -q '^resume-worker/package' <<< "$CHANGED"; then
  log "worker deps changed — npm install"
  npm install --prefix "$REPO_DIR/resume-worker" >> "$LOG" 2>&1
fi

if grep -q '^supabase/migrations/' <<< "$CHANGED"; then
  apply_migrations
fi

if grep -q '^resume-worker/' <<< "$CHANGED"; then
  log "restarting resume-worker"
  launchctl kickstart -k "gui/$(id -u)/com.applypilot.resume-worker" >> "$LOG" 2>&1 || log "worker kickstart failed (label not installed?)"
fi

# optional heartbeat
HC=$(grep -E '^HC_PING_AUTOPULL=' "$SH/.env" 2>/dev/null | cut -d= -f2-)
[[ -n "${HC:-}" ]] && curl -fsS -m 10 "$HC" >/dev/null 2>&1 || true

log "done at $(git rev-parse --short HEAD)"
