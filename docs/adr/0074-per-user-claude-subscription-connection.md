# ADR 0074: Per-user Claude subscription connection

- Status: accepted
- Date: 2026-07-14

## Context

ADR 0073 isolated application data and API keys, but subscription-mode Claude
still used the server owner's Claude Code login. Non-owner accounts therefore
could not select Claude subscription for résumé tailoring.

Anthropic does not provide a general third-party consumer-login API for the
Messages API. Claude Code does provide an official `claude auth login
--claudeai` PKCE flow for Claude subscriptions. It returns an Anthropic-hosted
authorization URL and accepts a one-time authorization code; the application
must never collect the user's Claude password, cookies, or raw browser session.

## Decision

The always-on worker brokers Claude Code's official login flow:

1. An authenticated ApplyPilot user starts the connection from Settings.
2. The worker launches `claude auth login --claudeai` with a UUID-specific
   `CLAUDE_CONFIG_DIR` under `backend/data/claude-users/`.
3. The browser opens the returned `claude.com` PKCE authorization URL.
4. The user pastes Anthropic's one-time code into ApplyPilot within ten minutes.
5. The worker verifies `claude auth status --json` reports OAuth login.

Ordinary Claude subscription work is then bound to that exact user directory.
There is no cross-user fallback. The original owner's legacy login remains only
for the owner and for the explicitly shared, one-time onboarding lane.

The connection can be removed from Settings. Disconnect deletes only that
user's UUID-namespaced credentials. Backups containing worker data are mode
`0600` because they may now contain OAuth refresh credentials.

## Consequences

- Users can use Claude subscription mode for tailoring without sharing an API
  key or Claude password with ApplyPilot.
- The server laptop must be online for login and subscription-backed work.
- A pending login is process-local and expires after ten minutes; a worker
  restart requires starting the connection again, but completed connections
  survive restarts.
- Claude plan, Agent SDK credit, rate limits, and Anthropic terms still apply.
- API-key-backed Anthropic remains available as the production/predictable-
  billing alternative.
