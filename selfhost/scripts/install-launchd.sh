#!/bin/zsh
# Installs the four selfhost launchd jobs (stack-up-at-login, autopull,
# watchdog, nightly backup). Idempotent — reinstalls over existing ones.
set -euo pipefail

SH="$(cd "$(dirname "$0")/.." && pwd)"
AGENTS="$HOME/Library/LaunchAgents"
mkdir -p "$AGENTS" "$SH/logs"

# docker CLI location differs between Docker Desktop and OrbStack; find it once.
DOCKER_BIN=$(command -v docker || echo /usr/local/bin/docker)

for plist in "$SH"/launchd/*.plist; do
  name=$(basename "$plist")
  target="$AGENTS/$name"
  sed -e "s|__SELFHOST__|$SH|g" -e "s|/usr/local/bin/docker|$DOCKER_BIN|g" "$plist" > "$target"
  label="${name%.plist}"
  launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$target"
  echo "installed $label"
done

launchctl list | grep com.applypilot.selfhost || true
echo "done. autopull+watchdog run every 5 min; backup at 03:30."
