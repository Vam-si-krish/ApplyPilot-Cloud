# DAY 20 — 2026-07-14 (per-user ChatGPT and Candidate Profile controls)

## Audit

- ChatGPT subscription execution existed, but non-owner accounts had no way to create a
  UUID-isolated Codex login. The worker otherwise rejected their ordinary ChatGPT work.
- Résumé editing lived under Tailor & Apply while eligibility facts lived in Profile;
  recurring application answers and user-managed scoring/tailoring guidance had no
  durable home.
- The local ATS matcher still inherited an owner-wide cap for all clearance/citizenship
  postings, which could hide a good job from an eligible candidate before the per-user AI
  context was considered.

## Implementation

- Added ADR 0081 and an authenticated ChatGPT device-login broker. Each account uses a
  forced file-backed `CODEX_HOME` under its UUID, with API/access-token and base-URL
  overrides stripped. Settings displays OpenAI's official device URL/code, polls status,
  supports disconnect, and automatically selects ChatGPT for tailoring after connection.
- Consolidated ongoing candidate management under Candidate Profile: Résumé, Eligibility,
  Application Answers, AI Guidance, Personal, and Skills. Removed the duplicate Base
  résumé editor from Tailor & Apply.
- Added RLS-owned `candidate_preferences` with normalized avoidance flags, recurring
  application answers, and constrained scoring/tailoring guidance. Contexts are
  purpose-limited for scoring, tailoring, and ApplyBuddy.
- Removed the universal local clearance cap. Explicit per-user avoidance remains a
  decisive score-1 rule in both direct and subscription scoring.

## Verification

- Added regression coverage for UUID-isolated ChatGPT credentials, official device-code
  parsing, subscription-only status, candidate preference normalization/purpose limits,
  ApplyBuddy context isolation, global tailoring guidance, scoring preferences, and the
  candidate-neutral ATS matcher.
- Full gates passed: 195 app tests (9 credentialed eval runs skipped), 11 worker tests,
  2 backend tests, TypeScript typecheck, production build, and documentation checks
  (111 Markdown files, 75 ADRs).
- Migration 0048 applied to `jobpilot_multi`; PostgREST was restarted, public health
  returned database API ready, and the live schema reported `candidate_preferences:jsonb`.
- The isolated worker restarted successfully; local and public `/version` advertised
  `chatgpt-user-login`, and an authenticated pilot-2 status probe returned a clean,
  disconnected UUID-specific ChatGPT state.
