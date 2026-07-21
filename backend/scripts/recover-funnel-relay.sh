#!/bin/zsh
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

# Tailscale's documented recovery for an unavailable relay is down/up. Funnel mappings
# configured with --bg persist across the reconnect, so this does not reset or rewrite
# the reserved root, split-six, production, or development mapping.
sleep 2
tailscale down --reason "Recover unavailable public Funnel relay"
sleep 2
tailscale up
