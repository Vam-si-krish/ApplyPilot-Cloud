#!/bin/zsh
set -euo pipefail

# Check the public Funnel relay instead of Tailscale's split-DNS 100.x address. A normal
# curl from the server can succeed privately while Netlify and other internet clients
# cannot connect, which previously made the watchdog report a false healthy state.
URL="${1:-}"
[[ "$URL" =~ '^https://([^/]+)(/.*)?$' ]] || exit 64
HOST="$match[1]"

IPS=("${(@f)$(dig @8.8.8.8 +short "$HOST" A 2>/dev/null | grep -E '^[0-9]+(\.[0-9]+){3}$')}" )
(( ${#IPS[@]} > 0 )) || exit 1

for IP in "${IPS[@]}"; do
  if curl -fsS -m 12 --resolve "${HOST}:443:${IP}" "$URL" >/dev/null 2>&1; then
    exit 0
  fi
done
exit 1
