#!/usr/bin/env bash
#
# Manage the worker's Claude subscription accounts (ADR 0042). Each account is an
# isolated CLAUDE_CONFIG_DIR with its own login, so two plans = two credit pools.
#
#   ./switch-account.sh                # show accounts + which is active
#   ./switch-account.sh 2              # make account 2 the active (first-tried) one + restart
#
# To set up a NEW account (one-time, opens a browser), log it into its own dir:
#   CLAUDE_CONFIG_DIR=~/.claude-acct2 claude        # then /login inside, as ACCOUNT 2
# The worker auto-detects ~/.claude-acctN once it exists; the other account stays as
# automatic failover when the active one hits its monthly cap.
#
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$DIR/.env"
SERVICE="com.applypilot.resume-worker"
[ -f "$ENV_FILE" ] || { echo "no .env at $ENV_FILE"; exit 1; }

active()  { grep -E '^CLAUDE_ACTIVE_ACCOUNT=' "$ENV_FILE" | tail -1 | cut -d= -f2 || true; }
has_tok() { grep -qE "^CLAUDE_CODE_OAUTH_TOKEN_${1}=" "$ENV_FILE"; }
cfgdir()  {                                   # account N → its config dir
  local n="$1" d
  d="$(grep -E "^CLAUDE_CONFIG_DIR_${n}=" "$ENV_FILE" | tail -1 | cut -d= -f2- || true)"
  if   [ -n "$d" ];      then echo "$d"
  elif [ "$n" = 1 ];     then echo "$HOME/.claude"   # default (Keychain) unless isolated
  else                        echo "$HOME/.claude-acct${n}"; fi
}

N="${1:-status}"

if [ "$N" = "status" ]; then
  cur="$(active)"
  echo "active account (tried first): ${cur:-1}"
  for n in 1 2 3; do
    d="$(cfgdir "$n")"
    if   [ "$n" = 1 ];                 then echo "  account 1: $d  [default login]"
    elif [ -f "$d/.credentials.json" ] || has_tok "$n"; then echo "  account $n: $d  [ready]"
    else echo "  account $n: $d  [not set up → CLAUDE_CONFIG_DIR=$d claude  then /login]"; fi
  done
  exit 0
fi

case "$N" in 1|2|3|4|5) ;; *) echo "usage: $0 [status | <account 1-5>]"; exit 1 ;; esac

# Warn (don't block) if the chosen account has no login yet.
d="$(cfgdir "$N")"
if [ "$N" != 1 ] && [ ! -f "$d/.credentials.json" ] && ! has_tok "$N"; then
  echo "warning: account $N has no login at $d — set it up first:"
  echo "         CLAUDE_CONFIG_DIR=$d claude    # then /login as account $N"
fi

# Upsert CLAUDE_ACTIVE_ACCOUNT=N (portable in-place edit via temp file).
tmp="$(mktemp)"
if grep -qE '^CLAUDE_ACTIVE_ACCOUNT=' "$ENV_FILE"; then
  sed "s/^CLAUDE_ACTIVE_ACCOUNT=.*/CLAUDE_ACTIVE_ACCOUNT=${N}/" "$ENV_FILE" > "$tmp"
else
  cat "$ENV_FILE" > "$tmp"
  printf 'CLAUDE_ACTIVE_ACCOUNT=%s\n' "$N" >> "$tmp"
fi
mv "$tmp" "$ENV_FILE"

echo "set CLAUDE_ACTIVE_ACCOUNT=${N} — restarting worker…"
launchctl kickstart -k "gui/$(id -u)/${SERVICE}"
echo "done. watch: tail -f \"$DIR/logs/worker.out.log\""
