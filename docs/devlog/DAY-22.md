# DAY 22 — 2026-07-15 (Validated candidate AI controls)

## Audit

- The tailoring prompt hard-coded a roughly 15-day learnable-skill policy and honest
  title reframing. The scoring prompt hard-coded a roughly two-to-three-year soft
  experience gap, mostly ignored overqualification, and treated contract status only as
  an annotation.
- Free-form user guidance could express preferences but was not a reliable or discoverable
  way to control those reviewed trade-offs. Parser contracts, rubric weights/caps,
  eligibility proof, verified facts, tenure, disclosure, and one-page limits must remain
  protected.

## Implementation

- Added ADR 0083 and validated per-user policy fields in `candidate_preferences` for:
  missing-skill policy, 7/15/30/60-day learning horizon, title alignment, evidence
  standard, 0–5-year experience-gap tolerance, overqualification treatment, and
  contract-role treatment.
- Added explained controls under **Candidate Profile → AI Guidance**. Existing behavior is
  the default; saved changes affect new scores and generations only.
- Mirrored preference normalization and prompt injection in the Netlify/direct and
  UUID-scoped worker paths. Strict title preservation and Base-résumé-only skills are also
  enforced deterministically during merge.
- Kept free-form scoring/tailoring guidance for emphasis while excluding all new policy
  fields from ApplyBuddy's purpose-limited recurring-answer context.
- Added the worker `candidate-prompt-controls` version marker. No schema migration or new
  dependency was required because preferences remain in the existing JSONB field.

## Verification

- Full app suite: 197 passed, 9 credentialed eval runs skipped.
- Worker suite: 14 passed, including direct/worker policy defaults and strict-merge tests.
- TypeScript typecheck, production build, documentation checks (114 Markdown files,
  77 ADRs), and `git diff --check` passed.
- Authenticated desktop (1440×1100) and mobile (390×844) Candidate Profile screenshots
  were inspected; controls, explanations, two-column desktop layout, and single-column
  mobile flow rendered correctly.

## Deployment

- Implementation commit `9836300` was pushed to `multi-user-fork`.
- The isolated `com.jobpilotmulti.worker` service restarted successfully. Local and
  public `/version` both reported commit `9836300` with the
  `candidate-prompt-controls` marker; public gateway health also passed.
- The branch push is the frontend deployment handoff. This checkout has no linked
  Netlify CLI site metadata, so the production build is the local frontend gate and the
  configured Netlify branch deployment remains observable in Netlify.
