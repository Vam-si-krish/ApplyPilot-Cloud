# DAY 19 — 2026-07-14 (owner-neutral AI context)

## Audit

- Both runtime scoring prompt copies still hardcoded the original owner's F-1 OPT/EAD
  and future H-1B status. Citizenship, residency, and clearance requirements were also
  treated as universal blockers instead of candidate-specific conditions.
- Tailoring and cover-letter prompts already received the authenticated user's structured
  Base résumé dynamically and contained no owner résumé facts.
- Scoring received the per-user Base résumé but not `profile.work_authorization`.
  ApplyBuddy received current résumé text alongside stale onboarding snapshots after a
  Base résumé edit.
- A developer render sample contained the owner's résumé details, and Settings offered
  owner-specific Boston-area locations to every account. Neither was an LLM runtime prompt,
  but both were inappropriate multi-user residue.

## Implementation

- Added ADR 0080. The shared scoring rubric is now owner-neutral; score-1 eligibility
  blockers require explicit current-candidate evidence, and missing facts mean unknown.
- Added an RLS-scoped AI candidate context containing the Base résumé plus only the current
  user's work-authorization JSON. Kept local ATS/prefilter input résumé-only.
- Extended the one-call onboarding parser to copy explicitly stated authorization facts,
  added tri-state Work Auth controls plus citizenship/residency and clearance fields, and
  documented exactly where users update AI inputs.
- Made ApplyBuddy replace stale onboarding résumé snapshots with the current Base résumé.
- Replaced the owner render sample and regional Settings suggestions with fictional/generic
  data, and mirrored scoring changes in the subscription worker.

## Verification

- Added unit coverage for owner-neutral direct/worker prompts, candidate-context assembly,
  onboarding authorization extraction, unknown defaults, and ApplyBuddy snapshot refresh.
- Updated the clearance blocker eval to carry explicit ineligible facts and added an
  eligible citizen/TS-SCI case that must not be blocked.
- Full verification passed: 191 app tests (9 credentialed eval runs skipped), 2 backend
  tests, 8 worker tests, TypeScript typecheck, production build, and documentation checks
  (109 Markdown files, 74 ADRs).
