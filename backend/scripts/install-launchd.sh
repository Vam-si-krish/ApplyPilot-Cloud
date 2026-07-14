#!/bin/zsh
set -euo pipefail
BACKEND="$(cd "$(dirname "$0")/.." && pwd)"
USER_AGENTS="$HOME/Library/LaunchAgents"
mkdir -p "$USER_AGENTS" "$BACKEND/logs"

for template in "$BACKEND"/launchd/*.plist; do
  name=$(basename "$template")
  output="$USER_AGENTS/$name"
  sed "s|__BACKEND__|$BACKEND|g" "$template" > "$output"
  plutil -lint "$output" >/dev/null
  launchctl bootout "gui/$(id -u)/${name%.plist}" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$output"
done

launchctl kickstart -k "gui/$(id -u)/com.jobpilotmulti.backend"
launchctl kickstart -k "gui/$(id -u)/com.jobpilotmulti.worker"
