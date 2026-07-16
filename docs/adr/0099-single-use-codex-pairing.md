# ADR 0099: Single-use Codex pairing replaces browser token export

- Status: accepted
- Date: 2026-07-16
- Amends: ADRs 0096 and 0098

## Context

The development stdio MCP foundation required a user to copy `APPLYPILOT_URL` and a
two-hour bearer token from the browser into the terminal that launched Codex. That proved
the scoped API boundary, but it was poor product behavior: Codex Desktop would not inherit
an export pasted elsewhere, the secret could be exposed in chat or shell history, and the
button looked like normal connection setup even though it revealed a reusable credential.

Codex's local stdio MCP configuration supports process environment values. Native
OAuth authentication belongs to a remote Streamable HTTP MCP server, which is a larger
deployment change than this development iteration.

## Decision

- Remove browser creation and display of bearer tokens. `POST /api/ai-agent/runs` no
  longer exists; the run endpoint lists and revokes connections only.
- A signed-in user may create a 12-character, ten-minute pairing code. Only its
  AUTH_SECRET-keyed hash is stored in the forced-RLS `ai_agent_pairings` table, and a new
  code invalidates the user's older unused codes.
- Add `connect_applypilot` as the sixth MCP tool. It sends the code directly to the
  development pairing endpoint, which atomically consumes it and returns a two-hour,
  revocable bearer token only to the MCP process. The process holds that token in memory
  and never returns it in tool output.
- The unauthenticated exchange performs one narrowly bounded service-scoped lookup by
  opaque code hash. Once the owner UUID is recovered, consumption and run creation use an
  explicit UUID-scoped database gateway. Invalid, expired, and reused codes fail closed.
- Redesign the AI Apply header around queue health, connection state, Pair/Disconnect,
  and a compact three-step explanation. The copied batch prompt remains a secondary
  fallback.
- Keep a remote Streamable HTTP MCP server with OAuth as the durable Phase 2 direction.
  Pairing is the safer bridge for the currently installed local stdio plugin.

## Consequences

- Users copy a harmless-after-use, short-lived pairing instruction instead of a reusable
  bearer credential or shell exports. No environment setup or Codex restart is required.
- A restarted MCP process must pair again because its access token is intentionally not
  persisted to disk.
- The pairing endpoint is public by necessity, so the code has approximately 60 bits of
  entropy, a ten-minute lifetime, single-use semantics, keyed hashing at rest, and no
  user-identifying lookup input.
- The development site can show and revoke active Codex connections. This does not yet
  provide durable refresh or native Codex OAuth.

## Verification

- Unit-test pairing generation, normalization, keyed hashing, expiry constant, and the
  six-tool MCP handshake.
- Contract-test forced RLS, atomic consumption, removal of browser token minting, and the
  absence of token-export strings in the AI Apply UI.
- Run application tests, TypeScript, documentation validation, build, plugin validation,
  and a paired live development MCP queue read.
