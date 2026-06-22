#!/usr/bin/env bash
# Install the résumé worker as a launchd service so it starts on boot and restarts
# if it crashes (ADR 0024 Phase 4). Run this ON the always-on server laptop, from
# inside the resume-worker/ folder, after `npm install` and creating `.env`.
#
#   ./install-service.sh          # install + start
#   ./install-service.sh remove   # stop + uninstall
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
NODE="$(command -v node || true)"
LABEL="com.applypilot.resume-worker"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

if [[ "${1:-}" == "remove" ]]; then
  launchctl unload "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
  echo "removed $LABEL"
  exit 0
fi

[[ -n "$NODE" ]] || { echo "node not found on PATH — install Node 18+ first"; exit 1; }
[[ -f "$DIR/.env" ]] || { echo "missing $DIR/.env — copy .env.example to .env and fill it in first"; exit 1; }

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
    <string>$DIR/server.js</string>
  </array>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$DIR/logs/worker.out.log</string>
  <key>StandardErrorPath</key><string>$DIR/logs/worker.err.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
</dict>
</plist>
EOF

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
sleep 1
echo "loaded $LABEL — health check:"
curl -s "http://localhost:${PORT:-8787}/health" || echo "(worker not responding yet; check $DIR/logs/worker.err.log)"
echo
