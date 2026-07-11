#!/bin/zsh
# One-shot bootstrap for the SERVER laptop (phase 2). Run from the repo:
#   cd ~/Desktop/projects/ApplyPilot-Cloud/selfhost && ./scripts/bootstrap.sh
# Prereqs (phase 1, manual, once): Docker Desktop or OrbStack installed and set
# to start at login; Tailscale installed + logged in (+ SSH enabled); macOS
# auto-login on; FileVault off; sleep disabled.
set -euo pipefail

SH="$(cd "$(dirname "$0")/.." && pwd)"
cd "$SH"

echo "==> preflight"
command -v docker >/dev/null || { echo "docker CLI not found — install OrbStack or Docker Desktop"; exit 1; }
docker info >/dev/null 2>&1 || { echo "docker daemon not running — start OrbStack/Docker Desktop"; exit 1; }
command -v tailscale >/dev/null || command -v /Applications/Tailscale.app/Contents/MacOS/Tailscale >/dev/null || { echo "tailscale not found"; exit 1; }

echo "==> secrets"
node scripts/generate-keys.mjs

echo "==> starting stack (first pull is ~2 GB)"
docker compose pull -q
docker compose up -d

echo "==> waiting for health"
for i in {1..60}; do
  UNHEALTHY=$(docker compose ps --format '{{.Name}} {{.Status}}' | grep -cv 'healthy\|running' || true)
  docker compose ps --format '{{.Name}} {{.Status}}' | grep -q 'healthy' && [ "$UNHEALTHY" -eq 0 ] && break
  sleep 5
done
docker compose ps

echo "==> enabling Tailscale Funnel on Kong"
KONG_PORT=$(grep -E '^KONG_HTTP_PORT=' .env | cut -d= -f2-); KONG_PORT=${KONG_PORT:-8000}
tailscale funnel --bg "$KONG_PORT"
tailscale funnel status || true

echo
echo "!! Copy the https://….ts.net URL above into selfhost/.env as SUPABASE_PUBLIC_URL,"
echo "   API_EXTERNAL_URL and SITE_URL, then: docker compose up -d (recreates with the URL)."
echo
echo "==> installing launchd jobs (stack-up, autopull, watchdog, backup)"
./scripts/install-launchd.sh

echo
echo "NEXT (from the dev Mac):"
echo "  1. CLOUD_PGPASSWORD='...' ./scripts/restore-from-cloud.sh   # bring the data over"
echo "  2. Point Netlify env at the Funnel URL + new keys, redeploy   # cutover"
echo "  3. Update resume-worker/.env SUPABASE_URL=http://127.0.0.1:$KONG_PORT + new service key"
