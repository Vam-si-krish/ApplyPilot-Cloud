#!/bin/zsh
set -euo pipefail
BACKEND="$(cd "$(dirname "$0")/.." && pwd)"
REPO="$(cd "$BACKEND/.." && pwd)"
LOG="$BACKEND/logs/autopull.log"
mkdir -p "$BACKEND/logs"
set -a; source "$BACKEND/.env"; set +a
log() { echo "$(date '+%F %T') $*" >> "$LOG"; }

LOCK=/tmp/jobpilotmulti-autopull.lock
if ! mkdir "$LOCK" 2>/dev/null; then exit 0; fi
trap 'rmdir "$LOCK"' EXIT

cd "$REPO"
if [[ -n "$(git status --porcelain)" ]]; then
  log "refusing to update a dirty checkout"
  exit 1
fi
git fetch origin "$BRANCH" --quiet
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse "origin/$BRANCH")
if [[ "$LOCAL" == "$REMOTE" ]]; then exit 0; fi

log "updating $LOCAL -> $REMOTE"
git merge --ff-only "origin/$BRANCH" --quiet
CHANGED=$(git diff --name-only "$LOCAL" HEAD)

if grep -qE '^(backend/package|resume-worker/package)' <<< "$CHANGED"; then
  npm ci --prefix "$BACKEND" >> "$LOG" 2>&1
  npm ci --prefix "$REPO/resume-worker" >> "$LOG" 2>&1
fi

node "$BACKEND/migrate.mjs" >> "$LOG" 2>&1
docker compose --project-directory "$BACKEND" --env-file "$BACKEND/.env" up -d >> "$LOG" 2>&1
launchctl kickstart -k "gui/$(id -u)/com.jobpilotmulti.backend" >> "$LOG" 2>&1 || true
launchctl kickstart -k "gui/$(id -u)/com.jobpilotmulti.worker" >> "$LOG" 2>&1 || true
log "updated to $(git rev-parse --short HEAD)"
