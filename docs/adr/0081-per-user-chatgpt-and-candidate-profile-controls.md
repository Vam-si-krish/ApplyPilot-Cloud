# ADR 0081 — Per-user ChatGPT connection and centralized candidate controls

**Status:** accepted · **Date:** 2026-07-14 · **Amends:** ADRs 0069, 0074, and 0080

## Context

ADR 0069 added a ChatGPT-subscription execution backend, but its login was a single
deployment-level `CODEX_HOME`. That is acceptable for the original owner deployment and
the bounded shared onboarding parse, not for ordinary work in a multi-user product. Each
account must connect its own subscription without exposing an OpenAI API key, password,
browser cookies, or credentials to another account.

Candidate inputs were also spread across Tailor & Apply and Profile. Users need one
maintainable location for the résumé, authorization/sponsorship/clearance facts, recurring
application answers, job-avoidance choices, and user-authored AI guidance. Free-form
guidance must not replace reviewed system prompts or weaken truthfulness and output
contracts.

## Decision

### UUID-isolated ChatGPT device login

Settings brokers the official Codex CLI device-auth flow through the always-on worker:

1. The authenticated user starts **Settings → ChatGPT connection**.
2. The worker runs `codex login --device-auth` with a UUID-specific `CODEX_HOME` under
   `backend/data/chatgpt-users/<uuid>/` and forces file credential storage.
3. ApplyPilot displays OpenAI's official device URL and one-time code. Authentication and
   the ChatGPT password stay on OpenAI's site.
4. Settings polls `codex login status`; only `Logged in using ChatGPT` is accepted.
5. Every ordinary Codex SDK call receives that same user's isolated home. API keys,
   access-token overrides, and custom base URLs are stripped. There is no cross-user
   fallback.

The owner's legacy login and the shared server subscription remain available only for
the existing owner compatibility path and the explicitly bounded one-time onboarding
parse. Disconnecting removes only the authenticated UUID's ChatGPT directory.

### One Candidate Profile, purpose-limited consumers

**Candidate Profile** becomes the single ongoing management surface:

- **Résumé** owns the structured Base résumé. The duplicate editor is removed from
  Tailor & Apply.
- **Eligibility** owns work authorization, sponsorship, citizenship/residency,
  clearance facts, and explicit clearance/citizenship-restriction avoidance switches.
- **Application Answers** owns stable facts used by ApplyBuddy, such as relocation,
  availability, work arrangement, employment types, and salary expectations.
- **AI Guidance** owns constrained scoring and résumé-tailoring instructions.

Migration 0048 adds `profile.candidate_preferences` as user-owned JSONB. Existing forced
RLS protects it with the profile row. The API normalizes supported fields and length
limits before persistence. Consumers receive only what they need:

- scoring receives avoidance flags and scoring guidance;
- tailoring receives global tailoring guidance, followed by any per-job guidance;
- ApplyBuddy receives recurring application answers, not scorer/tailorer instructions.

User guidance refines emphasis and trade-offs but cannot override anti-fabrication,
candidate-specific eligibility, score scale/format, verified-fact protection, or résumé
length constraints. Avoidance switches are decisive score-1 preferences. The local ATS
matcher no longer applies the previous universal clearance cap; candidate-specific
eligibility and avoidance remain the AI scorer's responsibility.

## Consequences

- Every fixed account can use its own ChatGPT/Codex entitlement without an API key.
- Completed ChatGPT credentials survive worker restarts; pending device flows do not.
- ChatGPT plan limits, workspace policy, model availability, and OpenAI terms still apply.
- OAuth/device credentials are present in mode-`0600` local backups. Credential encryption
  at rest and encrypted off-host backups remain Phase 2B gates before public signup.
- Saved profile changes affect new scores and generations. Historical scores and files are
  not silently rewritten; users must rescore or regenerate them.

## Verification

- UUID path and subprocess-environment isolation tests; device-output/status parsing tests.
- Candidate-preference boundary, context-purpose, scorer, tailorer, ApplyBuddy, and local
  ATS regression tests.
- App tests, worker tests, TypeScript typecheck, production build, migration/schema-cache
  reload, and authenticated worker health/version checks.

## Official references

- [Codex authentication](https://developers.openai.com/codex/auth/)
- [Codex CLI reference](https://developers.openai.com/codex/cli/reference/)
- [Codex SDK](https://developers.openai.com/codex/sdk/)
