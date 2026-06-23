#!/usr/bin/env bash
# Install the self-updating Cloudflare tunnel (tunnel.mjs) as a launchd service so it
# starts on boot, restarts if it crashes, and keeps the app's resume_worker_url current
# (ADR 0032). Run this ON the always-on Mac, from inside resume-worker/, after the
# worker's .env exists and `cloudflared` is installed (brew install cloudflared).
#
#   ./install-tunnel-service.sh          # install + start
#   ./install-tunnel-service.sh remove   # stop + uninstall
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
NODE="$(command -v node || true)"
CLOUDFLARED="$(command -v cloudflared || true)"
LABEL="com.applypilot.resume-tunnel"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

if [[ "${1:-}" == "remove" ]]; then
  launchctl unload "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
  echo "removed $LABEL"
  exit 0
fi

[[ -n "$NODE" ]] || { echo "node not found on PATH — install Node 18+ first"; exit 1; }
[[ -n "$CLOUDFLARED" ]] || { echo "cloudflared not found — run: brew install cloudflared"; exit 1; }
[[ -f "$DIR/.env" ]] || { echo "missing $DIR/.env (needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)"; exit 1; }

# Make sure cloudflared's dir is on PATH for the launchd job (spawned by tunnel.mjs).
CF_DIR="$(dirname "$CLOUDFLARED")"
mkdir -p "$HOME/Library/LaunchAgents" "$DIR/logs"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$DIR/tunnel.mjs</string>
  </array>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$DIR/logs/tunnel.out.log</string>
  <key>StandardErrorPath</key><string>$DIR/logs/tunnel.err.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$CF_DIR:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
</dict>
</plist>
EOF

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "loaded $LABEL — tunnel will publish its URL to settings.resume_worker_url"
echo "logs: $DIR/logs/tunnel.{out,err}.log"
