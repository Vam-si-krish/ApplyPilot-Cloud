# ADR 0102: Production endpoint for the installed ApplyPilot plugin

- Status: accepted
- Date: 2026-07-16
- Amends: ADR 0098
- Builds on: ADRs 0099 and 0100

## Context

The local ApplyPilot plugin was first installed for development validation, so both its
packaged MCP environment and script fallback targeted `applydev.vamsikrish.com`. The
production AI Apply page correctly created one-time pairing codes in the production
database, but the installed MCP process sent those codes to development. A code hash is
environment-specific because the databases and `AUTH_SECRET` values are isolated.

The pairing endpoint intentionally gives the same response for a missing, expired, or
consumed hash. As a result, every fresh production code appeared “expired or already
used,” even though reloading and creating another code could not repair the endpoint
mismatch.

## Decision

- Package `https://apply.vamsikrish.com` as the ApplyPilot MCP endpoint and use it as the
  script fallback.
- Keep development available only through an explicit `APPLYPILOT_URL` override during
  development testing.
- Validate that the packaged `.mcp.json` cannot silently regress to the development URL.
- Refresh the plugin cachebuster, reinstall `applypilot@personal`, and require a new Codex
  thread so the updated MCP process and environment are loaded.

## Consequences

- Pairing codes created in production are exchanged against the same isolated production
  database and keyed hash boundary.
- A developer must deliberately opt into the development endpoint; production users do
  not need to copy or configure an environment value.
- Existing threads retain their already-started MCP process and cannot observe this
  correction. A new thread is part of the update boundary.

## Verification

- Plugin tests assert the production packaged endpoint and fallback.
- Plugin validation and the cachebuster/reinstall flow pass.
- In a new thread, exchange a newly generated production pairing code and perform a
  user-scoped assigned-queue read.
