#!/usr/bin/env bash
# Install the hourly overnight-tailoring trigger as a launchd job on the always-on
# Worker Mac (ADR 0043). The app is on Netlify (no vercel.json crons), so this machine
# owns the schedule. It fires tailor-queue-trigger.sh every hour at :00; the worker
# self-gates on the Settings UI (auto_tailor_enabled + auto_tailor_time), so only the
# tick at the configured hour actually drains the queue.
#
#   ./install-tailor-queue-cron.sh          # install + start
#   ./install-tailor-queue-cron.sh remove   # stop + uninstall
#
# IMPORTANT — sleep: launchd's StartCalendarInterval fires on schedule only while the Mac
# is awake. If the laptop sleeps overnight, the run is DEFERRED until it next wakes (it is
# NOT skipped, but it won't run at exactly 4am). To run at the exact hour, either keep the
# Mac awake (System Settings → Battery/Energy → prevent sleep, or `caffeinate`), or add a
# wake schedule:  sudo pmset repeat wakeorpoweron MTWRFSU 03:58:00
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
LABEL="com.applypilot.tailor-queue"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
TRIGGER="$DIR/tailor-queue-trigger.sh"

if [[ "${1:-}" == "remove" ]]; then
  launchctl unload "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
  echo "removed $LABEL"
  exit 0
fi

[[ -f "$DIR/.env" ]] || { echo "missing $DIR/.env — set it up (PORT + WORKER_SECRET) first"; exit 1; }
[[ -f "$TRIGGER" ]] || { echo "missing $TRIGGER"; exit 1; }
chmod +x "$TRIGGER"
mkdir -p "$HOME/Library/LaunchAgents" "$DIR/logs"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$TRIGGER</string>
  </array>
  <key>WorkingDirectory</key><string>$DIR</string>
  <!-- Fire every hour at minute 0. The worker no-ops unless it's the configured hour. -->
  <key>StartCalendarInterval</key>
  <dict>
    <key>Minute</key><integer>0</integer>
  </dict>
  <key>StandardOutPath</key><string>$DIR/logs/tailor-queue.out.log</string>
  <key>StandardErrorPath</key><string>$DIR/logs/tailor-queue.err.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
</dict>
</plist>
EOF

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "loaded $LABEL — fires hourly at :00."
echo "watch: tail -f \"$DIR/logs/tailor-queue.out.log\""
echo "test now (bypasses the schedule gate via the worker's manual path is NOT used here;"
echo "         this runs the scheduled path, so it only drains if it's the configured hour):"
echo "  bash \"$TRIGGER\""
