#!/bin/zsh
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

# Forced-command target for the personal-laptop deployment key (ADR 0088). The key's
# authorized_keys entry uses `restrict,command=".../remote-control.sh"`, so SSH supplies
# the requested operation only through SSH_ORIGINAL_COMMAND. Never eval that value.

CONTROL_BACKEND="$(cd "$(dirname "$0")/.." && pwd)"
PRODUCTION_REPO="$(cd "$CONTROL_BACKEND/.." && pwd)"
DEVELOPMENT_REPO="${JOBPILOT_DEVELOPMENT_REPO:-/Users/vamsikrish/apps/jobpilot-multi-dev}"
LOG="$CONTROL_BACKEND/logs/remote-control.log"
mkdir -p "$CONTROL_BACKEND/logs"
umask 077

fail() {
  print -u2 -- "Remote control refused: $1"
  exit 64
}

log() {
  print -- "$(date '+%F %T') $1" >> "$LOG"
}

health_wait() {
  local url="$1"
  local attempt
  for attempt in {1..20}; do
    if curl -fsS -m 8 "$url" 2>/dev/null; then
      print
      return 0
    fi
    sleep 1
  done
  return 1
}

show_help() {
  cat <<'EOF'
Allowed commands:
  help
  production|development help
  production|development status
  production|development repair-funnel
  production|development deploy <7-40 character git commit>
  production|development restart all|backend|worker|rest
  production|development logs backend|worker|autopull|watchdog <1-500 lines>
  production|development backup
  production|development dev-env
  provision-development <7-40 character git commit>
EOF
}

if [[ -z "${SSH_CONNECTION:-}" && "${JOBPILOT_REMOTE_CONTROL_LOCAL_TEST:-}" != "1" ]]; then
  fail "an SSH forced-command session is required"
fi

REQUEST="${SSH_ORIGINAL_COMMAND:-help}"
[[ "$REQUEST" != *$'\n'* && "$REQUEST" != *$'\r'* ]] || fail "multi-line commands are not allowed"

if [[ "$REQUEST" =~ '^(production|development) (.+)$' ]]; then
  ENVIRONMENT="$match[1]"
  REQUEST="$match[2]"
elif [[ "$REQUEST" == "help" || "$REQUEST" =~ '^provision-development [0-9a-f]{7,40}$' ]]; then
  ENVIRONMENT="production"
else
  fail "an explicit production or development target is required"
fi

if [[ "$ENVIRONMENT" == "production" ]]; then
  REPO="$PRODUCTION_REPO"
else
  REPO="$DEVELOPMENT_REPO"
fi
BACKEND="$REPO/backend"

case "$REQUEST" in
  help)
    show_help
    ;;

  provision-development\ *)
    EXPECTED="${REQUEST#provision-development }"
    [[ "$EXPECTED" =~ '^[0-9a-f]{7,40}$' ]] || fail "invalid development commit"
    log "provision-development $EXPECTED"
    /bin/zsh -lc 'exec "$1" "$2"' jobpilot-provision "$CONTROL_BACKEND/scripts/provision-development.sh" "$EXPECTED"
    ;;

  status)
    log "status"
    cd "$REPO"
    set -a; source "$BACKEND/.env"; set +a
    print -- "commit=$(git rev-parse --short HEAD)"
    if [[ -n "$(git status --porcelain)" ]]; then
      print -- "checkout=dirty"
    else
      print -- "checkout=clean"
    fi
    launchctl list | grep -E "com\.${APP_NAME}\.(backend|worker|autopull|watchdog|backup)" || true
    health_wait "http://127.0.0.1:${PORT}/health"
    health_wait "http://127.0.0.1:${WORKER_PORT}/version"
    if "$BACKEND/scripts/check-public-funnel.sh" "$PUBLIC_URL/health"; then
      print -- "public_funnel=healthy"
    else
      print -- "public_funnel=unhealthy"
    fi
    ;;

  repair-funnel)
    log "repair-funnel"
    set -a; source "$BACKEND/.env"; set +a
    tailscale funnel --bg --set-path "/${APP_PATH}" "http://127.0.0.1:${PORT}"
    for attempt in {1..20}; do
      if "$BACKEND/scripts/check-public-funnel.sh" "$PUBLIC_URL/health"; then
        print -- "public_funnel=repaired path=/${APP_PATH}"
        exit 0
      fi
      sleep 1
    done
    fail "Funnel did not become publicly reachable"
    ;;

  backup)
    log "backup"
    "$BACKEND/scripts/backup.sh"
    print -- "backup=complete"
    ;;

  dev-env)
    log "dev-env"
    ENV_FILE="$REPO/.env.local"
    [[ -f "$ENV_FILE" ]] || fail "server development environment is missing"
    MODE=$(stat -f '%Lp' "$ENV_FILE")
    [[ "$MODE" == "600" ]] || fail "server development environment must have mode 600"
    cat "$ENV_FILE"
    ;;

  *)
    if [[ "$REQUEST" =~ '^deploy ([0-9a-f]{7,40})$' ]]; then
      EXPECTED="$match[1]"
      log "deploy $EXPECTED"
      # Match launchd's login-shell environment so the server-managed Node/npm
      # installation is available. Reconcile even when an earlier deploy fast-forwarded
      # the checkout but failed before migrations or service restarts completed.
      /bin/zsh -lc 'exec "$1" --reconcile' jobpilot-autopull "$BACKEND/scripts/autopull.sh"
      cd "$REPO"
      ACTUAL=$(git rev-parse HEAD)
      [[ "$ACTUAL" == "$EXPECTED"* ]] || fail "server is at ${ACTUAL[1,7]}, expected $EXPECTED"
      set -a; source "$BACKEND/.env"; set +a
      health_wait "$PUBLIC_URL/health"
      health_wait "$PUBLIC_URL/worker/version"
      print -- "deploy=complete commit=${ACTUAL[1,7]}"
    elif [[ "$REQUEST" =~ '^restart (all|backend|worker|rest)$' ]]; then
      TARGET="$match[1]"
      log "restart $TARGET"
      set -a; source "$BACKEND/.env"; set +a
      if [[ "$TARGET" == "all" || "$TARGET" == "rest" ]]; then
        docker compose --project-name "$APP_NAME" --project-directory "$BACKEND" --env-file "$BACKEND/.env" restart rest
      fi
      if [[ "$TARGET" == "all" || "$TARGET" == "backend" ]]; then
        launchctl kickstart -k "gui/$(id -u)/com.${APP_NAME}.backend"
      fi
      if [[ "$TARGET" == "all" || "$TARGET" == "worker" ]]; then
        launchctl kickstart -k "gui/$(id -u)/com.${APP_NAME}.worker"
      fi
      if [[ "$TARGET" == "all" || "$TARGET" == "backend" || "$TARGET" == "rest" ]]; then
        health_wait "http://127.0.0.1:${PORT}/health"
      fi
      if [[ "$TARGET" == "all" || "$TARGET" == "worker" ]]; then
        health_wait "http://127.0.0.1:${WORKER_PORT}/version"
      fi
      print -- "restart=complete target=$TARGET"
    elif [[ "$REQUEST" =~ '^logs (backend|worker|autopull|watchdog) ([1-9][0-9]{0,2})$' ]]; then
      SERVICE="$match[1]"
      LINES="$match[2]"
      (( LINES <= 500 )) || fail "log request exceeds 500 lines"
      case "$SERVICE" in
        backend) FILE="$BACKEND/logs/backend.out.log" ;;
        worker) FILE="$BACKEND/logs/worker.out.log" ;;
        autopull) FILE="$BACKEND/logs/autopull.log" ;;
        watchdog) FILE="$BACKEND/logs/watchdog.log" ;;
      esac
      log "logs $SERVICE $LINES"
      [[ -f "$FILE" ]] || fail "$SERVICE log does not exist"
      tail -n "$LINES" "$FILE"
    else
      fail "command is not on the allowlist"
    fi
    ;;
esac
