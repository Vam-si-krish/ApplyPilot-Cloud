# ADR 0095: All linked jobs with known-fact AI fallback

- Status: accepted
- Date: 2026-07-15
- Amends: ADR 0094 extension-owned autofill with unattended AI navigation

## Context

The first AI-navigation version admitted only prepared External Apply rows, capped the
active queue at five, and treated every extension miss as a blocker. The owner wants all
jobs in Tailor & Apply to be movable into Assign to AI. The installed extension should
still fill first, but an isolated missed field should not stop a straightforward form
when ApplyPilot already contains the answer.

## Decision

- Any unapplied application with a valid HTTP(S) job/application link can be assigned,
  regardless of Easy Apply/External classification, LinkedIn host, tailoring status,
  résumé generation, or PDF availability.
- Remove the active assignment cap. The copyable Chrome prompt includes the next twenty
  active rows to keep a single browser handoff readable; remaining rows stay assigned
  for a later run.
- On each page, the extension fills first. AI may complete fields the extension missed
  only from information already available in Candidate Profile, saved application
  answers, the résumé, or the cover letter.
- If a required answer is absent from those sources, the AI marks the row **Needs
  review**, records the missing field in the existing bounded blocker reason, leaves that
  tab open, and continues with the next job in a new tab.
- Keep only two content rules in the run prompt: do not invent absent information, and
  record Submitted only after visible site success.
- `blocked` remains the storage value for backward compatibility; the product label is
  **Needs review**.

## Consequences

- Assignment is simple and uniform across the entire actionable Tailor & Apply list.
- A missing autofill value no longer creates unnecessary manual work when ApplyPilot
  already knows the answer.
- Jobs without a usable link cannot start a browser workflow and remain the only
  non-applied rows that cannot be assigned.
- The prompt batch size is an operational context limit, not a queue or eligibility cap.

## Verification

- Unit-test Easy Apply, LinkedIn, queued, and missing-PDF eligibility; retain applied and
  invalid-link rejection.
- Verify there is no route or UI active-queue cap and the prompt includes twenty rows.
- Verify fallback-field, Needs-review, leave-tab-open, and next-new-tab instructions.
- Run full application/backend/worker tests, TypeScript, docs validation, build, and the
  isolated development deployment.
