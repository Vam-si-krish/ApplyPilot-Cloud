# ADR 0083 — Validated candidate AI policy controls

**Status:** accepted · **Date:** 2026-07-15 · **Amends:** ADRs 0054, 0055, and 0081

## Context

The shared scoring and tailoring prompts contain real product trade-offs, not only
implementation rules. For example, tailoring historically allowed a missing skill when it
was adjacent or learnable in about 15 days, scoring treated a two-to-three-year experience
gap as modest, and title alignment allowed honest discipline reframing. Those defaults may
fit one candidate but not every account.

Free-form AI guidance alone is a poor control surface for these choices. A user should not
need to reverse-engineer the system prompt, and arbitrary text cannot safely replace score
parsing, eligibility, fact anchoring, or one-page constraints. The multi-user product needs
more control without allowing one account to corrupt the shared runtime contract.

## Decision

Add validated, per-user policy fields to `profile.candidate_preferences`, managed only in
**Candidate Profile → AI Guidance**:

- tailoring: Base-résumé-only, adjacent-only, or quickly-learnable skill additions; a
  7/15/30/60-day learning window; preserve titles or allow honest discipline reframing;
  and base-only evidence or plausible supporting detail with mandatory review disclosure;
- scoring: a 0–5-year soft experience-shortfall tolerance; ignore, note, or slightly
  penalize a genuine overqualification collision; and score contract roles normally,
  flag them without a penalty, or avoid them with an explicit preference score of 1.

Absent fields retain the reviewed historical behavior: learnable skills within 15 days,
honest title reframing, plausible detail with review, three years of shortfall tolerance,
no overqualification penalty, and neutral contract treatment. API and worker boundaries
discard unsupported values and inject only purpose-relevant controls.

Keep the shared prompts and invariants protected. Users cannot edit the score scale,
dimension weights, missing-core cap, exact response format, one-call contract,
anti-fabrication rules, eligibility proof standard, anchored identity/tenure facts,
disclosure/review step, or one-page budgets. Free-form guidance remains available for
emphasis and role preferences but cannot override those rules.

For strict choices that can be enforced structurally, use two layers. Both direct and
worker tailoring prompts receive the validated policy, and `mergeTailored` independently
restores the Base résumé's title/headline when title preservation is selected and restores
its skill list when evidenced-only skills are selected. Evidence-only wording is a prompt
constraint plus mandatory review because deterministic code cannot reliably distinguish a
rephrased achievement from an invented supporting detail.

## Consequences

- A candidate can choose 15 or 30 days, among bounded alternatives, without editing the
  protected prompt or affecting another user.
- New scores and generations use the saved policy immediately; historical scores and files
  remain unchanged until the user rescoring/regenerates them.
- The TypeScript/Netlify and JavaScript/worker copies must stay behaviorally mirrored.
  Worker preference projection has a dedicated helper and regression tests.
- The controls remain in JSONB, so no schema migration is required. Worker restart and
  frontend deployment are required.

## Verification

- Boundary/default tests for both direct and worker preference helpers.
- Prompt assertions for scoring controls and deterministic merge tests for strict title
  and skill policies in both runtime copies.
- Full app tests, worker tests, typecheck, production build, documentation checks, and
  authenticated worker version/health verification.
