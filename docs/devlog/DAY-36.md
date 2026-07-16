# Day 36 — Safe Codex pairing and AI Apply connection UX

**Date:** 2026-07-16  
**Branch:** `develop`

## Goal

Remove the confusing browser bearer-token copy flow and make AI Apply clearly show what
is assigned, what Codex is doing, what needs review, and whether Codex is connected.

## Implementation

- Replaced browser token minting with a 12-character, ten-minute, single-use pairing
  code. Only an AUTH_SECRET-keyed hash is stored in new forced-RLS
  `ai_agent_pairings`; creating a new code invalidates older unused codes.
- Added a bounded MCP pairing exchange. It atomically consumes the code, creates the
  existing revocable two-hour UUID-scoped run, and returns the bearer token directly to
  the local MCP process. The token remains in process memory and is never displayed,
  copied, stored in plugin configuration, or returned by an MCP tool.
- Removed `POST /api/ai-agent/runs`; the signed-in browser may only list and revoke
  active connections.
- Added the `connect_applypilot` tool and updated the bundled workflow so Codex asks for
  a one-time code only when disconnected. The plugin now has six tools and requires no
  user-managed environment values.
- Redesigned the AI Apply header with Assigned, Working, Needs review, and Submitted
  counts; explicit connected/disconnected state; Pair Codex and Disconnect controls; a
  compact three-step explanation; and the copied batch prompt demoted to a fallback.
- Recorded the stdio-vs-remote-OAuth boundary and durable direction in ADR 0099. Native
  OAuth remains a future remote Streamable HTTP MCP deployment; pairing is the safer
  bridge for the current local stdio plugin.

## Verification

- Pairing and plugin boundary tests pass, including keyed hashing, forced RLS, removal
  of browser token minting, and the six-tool MCP handshake.
- TypeScript passes.
- Full frontend tests pass: 227 passed and 9 evaluation cases intentionally skipped.
- Backend tests pass: 19/19. Résumé-worker tests pass: 20/20.
- TypeScript, documentation validation (149 Markdown files and 93 ADRs), plugin
  validation, `git diff --check`, and the optimized Next.js production build pass.
- Refreshed the local `applypilot@personal` installation from the repo marketplace at
  version `0.1.0+codex.20260716082507`; it reports installed and enabled.
- Pushed commit `40056c6` to `origin/develop` and ran the guarded development sync.
  Gateway health, worker health, and the clean server checkout all passed at that commit;
  migration 0052 was applied. Production was not touched.
- The first public pairing-route probe still reached the previous Netlify build and
  returned 404 immediately after the push. This is the expected five-minute frontend
  deployment window, not a backend failure, so no long deployment polling was performed.
- A signed-in visual click-through and paired live MCP read remain the owner acceptance
  check once Netlify serves the new build; browser control was unavailable in this
  session.
