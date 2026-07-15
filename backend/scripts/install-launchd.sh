#!/bin/zsh
set -euo pipefail
BACKEND="$(cd "$(dirname "$0")/.." && pwd)"
set -a; source "$BACKEND/.env"; set +a
[[ "$APP_NAME" =~ '^[a-z0-9]+$' ]] || { echo "Invalid APP_NAME" >&2; exit 64; }
USER_AGENTS="$HOME/Library/LaunchAgents"
mkdir -p "$USER_AGENTS" "$BACKEND/logs"

for template in "$BACKEND"/launchd/*.plist; do
  service=$(basename "$template" | sed -E 's/^com\.jobpilotmulti\.([^.]+)\.plist$/\1/')
  name="com.${APP_NAME}.${service}.plist"
  output="$USER_AGENTS/$name"
  sed -e "s|__BACKEND__|$BACKEND|g" -e "s|com\.jobpilotmulti|com.${APP_NAME}|g" "$template" > "$output"
  plutil -lint "$output" >/dev/null
  launchctl bootout "gui/$(id -u)/${name%.plist}" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$output"
done

launchctl kickstart -k "gui/$(id -u)/com.${APP_NAME}.backend"
launchctl kickstart -k "gui/$(id -u)/com.${APP_NAME}.worker"
