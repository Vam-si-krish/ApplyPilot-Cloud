#!/bin/zsh
set -euo pipefail
BACKEND="$(cd "$(dirname "$0")/.." && pwd)"
REPO="$(cd "$BACKEND/.." && pwd)"
set -a
source "$BACKEND/.env"
set +a
export BACKEND_URL="http://127.0.0.1:${PORT}"
export BACKEND_SERVICE_KEY="$SERVICE_ROLE_KEY"
export PORT="$WORKER_PORT"
export WORKER_SECRET
cd "$REPO/resume-worker"
exec node server.js
