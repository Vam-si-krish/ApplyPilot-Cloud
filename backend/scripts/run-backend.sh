#!/bin/zsh
set -euo pipefail
BACKEND="$(cd "$(dirname "$0")/.." && pwd)"
set -a
source "$BACKEND/.env"
set +a
cd "$BACKEND"
exec node server.mjs
