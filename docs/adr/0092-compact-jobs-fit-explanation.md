# ADR 0092: Compact Jobs fit explanation

- Status: accepted
- Date: 2026-07-15
- Amends: ADR 0022 presentation only

## Context

Each collapsed Jobs row displayed `score_note` as a wide, truncated sentence. The notes
often begin similarly, consume space needed for the job title/company/location, and
duplicate the complete `score_reasoning` already available in the expanded details.

## Decision

- Remove the dedicated `score_note` text column from collapsed Jobs rows.
- Give the reclaimed flexible width to job identity information.
- Preserve the short note in the AI fit-score chip's native hover tooltip and accessible
  label, together
  with its numeric score and a prompt to expand the row.
- Keep complete scoring reasoning and breakdowns in the expanded details. Bound tooltip
  note length so unexpectedly long persisted content cannot create an unusable tooltip.
- On desktop, reserve one stable column each for role type, apply type, company
  assessment, duplicate locations, ATS match, skill match, and opened status. Missing
  values leave their own cells empty instead of shifting later fields.
- Keep the action icons in a fixed-width rail and reserve the archive position even when
  a row is already archived.

## Consequences

- More of each title, company, location, salary, and company-size line can be seen without
  expanding the row.
- Repeated prose no longer dominates list scanning, but no scoring information is deleted
  or recomputed.
- Badges and actions align vertically across rows, making fields distinguishable without
  relying on the varying text inside each chip.
- The change is presentation-only: scoring prompts, persistence, RLS, and API boundaries
  are unchanged.

## Verification

- Regression-test whitespace normalization, the unscored label, tooltip length bound,
  stable metadata cells, and reserved action positions.
- Confirm the Jobs row no longer renders an inline `score_note` paragraph and that its
  score chip receives the tooltip text.
- Confirm metadata grid columns and the action rail remain present when values are absent.
- Run application tests, type checking, production build, and documentation validation.
