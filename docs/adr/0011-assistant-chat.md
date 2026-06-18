# ADR 0011 — ApplyBuddy assistant merged in as a chat tab
**Status:** accepted · **Date:** 2026-06-18
## Context
A separate sibling app, `../Job search/` (`job-application-assistant`, "ApplyBuddy"), answers job
application questions and recruiter emails as the applicant, grounded in a `profile.json`, via a
single LLM call returning a JSON contract. It was **single-shot** (paste → one answer; no follow-ups,
so you couldn't ask it to shorten or soften a draft). The user wants one app, not two: bring it in as
a tab with a real chat.
## Decision
Absorb it into ApplyPilot-Cloud as an **Assistant** tab, reusing Cloud's infrastructure instead of
porting ApplyBuddy's engine:
- `lib/assistant.ts` — the ApplyBuddy system prompt, adapted from the JSON-contract single-shot into a
  **multi-turn, plain-text chat** that can revise its own previous answer ("shorter / more formal /
  friendlier"). Grounded in the **Cloud profile** (`getProfile`), not a separate `profile.json`.
- `POST /api/assistant` — session-gated; builds `[system(profile), ...turns]` and calls the active
  vault key/provider via `buildScoringClient` (env fallback). A **separate call path** from fit
  scoring — the frozen `SCORE_PROMPT` is untouched (CLAUDE.md invariant). Providers/keys reuse
  `lib/llm.ts` + the vault, so ApplyBuddy's `src/providers.js` / `config.js` aren't ported.
- `app/(app)/assistant/page.tsx` — chat UI: bubbles, Enter-to-send, copy on replies, one-tap revise
  chips, "New chat", localStorage persistence, example prompts. Nav tab added in `AppShell`.
## Human-voice rules (research-backed)
The prompt got a "WRITE LIKE A HUMAN, NOT AN AI" section, synthesized from current best practice +
open-source humanizers (eesel, TextHumanize) and the common "AI tells" lists:
- contractions; **vary sentence length (burstiness)** — the #1 tell; be brief; be specific not
  generically eager;
- blocklist of clichés ("I hope this email finds you well", "please don't hesitate to reach out",
  "it's not just X, it's Y", …) and watermark words (delve, leverage, utilize, seamless, robust,
  furthermore, …) with plain-word swaps; at most one em-dash; allow natural imperfection.
## Alternatives considered
- **Keep two apps** — rejected: the user explicitly wants one.
- **Port ApplyBuddy's Node engine verbatim** — rejected: duplicates the LLM client + key handling
  Cloud already has; reuse is cleaner.
- **Keep the JSON contract** — rejected for chat: plain text + multi-turn is what enables "make it
  shorter / more polite".
## Notes
Grounding is only as good as the Cloud Profile. ApplyBuddy's richer `profile.json` fields
(`job_preferences`, `availability`, `eeo_voluntary`, `work_history`) aren't all in the Cloud profile
yet — extending the Profile page to hold them is a follow-up. No conversation history is stored
server-side (kept client-side in localStorage).
