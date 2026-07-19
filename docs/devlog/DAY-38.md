# Day 38 — Production ApplyPilot plugin pairing target

**Date:** 2026-07-16  
**Branch:** `multi-user-fork`

## Goal

Fix every newly generated production pairing code being rejected as expired or already
used by the installed ApplyPilot plugin.

## Implementation

- Changed the packaged MCP endpoint and script fallback from the isolated development
  site to `https://apply.vamsikrish.com`.
- Kept development access as an explicit `APPLYPILOT_URL` override rather than the
  installed default.
- Added a plugin-boundary regression check and documented the production promotion in
  ADR 0102.

## Boundaries and risk

- The authenticated owner creates the one-time code in production; the local MCP process
  is the caller and exchanges it only with the production Netlify API.
- The production database remains the code/run owner behind forced RLS. The MCP process
  receives only the existing two-hour UUID-scoped token in memory.
- No schema, user data, secret, or server service changes are required. The correction is
  a local plugin routing and installation change; the production branch remains its
  reviewed source of truth.

## Pre-deployment verification

- Plugin validation passes and the plugin-boundary test confirms the packaged endpoint
  and script fallback both target production.
- Refreshed the cachebuster to `0.1.0+codex.20260716092603`.
- Corrected the configured `personal` marketplace from the development worktree to the
  production worktree, reinstalled `applypilot@personal`, and verified the cached
  `.mcp.json`, script fallback, and six-tool handshake.
- Full frontend suite passes: 233 tests, with 9 evaluation cases intentionally skipped.
- TypeScript, documentation validation (154 Markdown files and 96 ADRs), optimized
  production build, and `git diff --check` pass.
