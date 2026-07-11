# ADR 0070 — Revert the ADR 0069 deployment (ChatGPT lanes) pending a clean re-land

**Date:** 2026-07-11 · **Status:** accepted

## Context
`d324e1d` (ADR 0069: `chatgpt_subscription` provider + three AI lanes) and `78fbc28`
("15 to 45" tailoring rework) were pushed to `main` — which Netlify auto-deploys —
while migration `0042_chat_model.sql` was **not applied** to the live DB. Saving
Settings therefore writes columns that don't exist. The user asked to return to the
pre-episode state after an outage (the outage itself was a Supabase egress
restriction, unrelated — see DAY-12).

## Decision
Revert both commits (`7ec633c`), restoring a tree byte-identical to `896d623` — the
last state proven good in production. Do **not** apply migration 0042 (it was never
applied, so code and schema match again after the revert). The file is removed from
`supabase/migrations/` by the revert; it lives in git history.

## Consequences
- Settings keep the pre-0069 model (scoring pair shared with chat); no schema drift.
- The three-lanes/ChatGPT feature is not lost — re-land it from history as a clean
  deploy in the right order: apply the migration first, then app + worker together,
  then `codex login` on the Worker Mac (`/version` must list `chatgpt-subscription`).
- The Worker Mac keeps running `d324e1d` until it pulls; its legacy `subscription`
  path is compatible with the reverted app in the interim.
