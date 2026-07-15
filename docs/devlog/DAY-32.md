# DAY 32 — 2026-07-15 (Compact Jobs rows)

## Owner request

- The owner requested a direct production presentation change after observing that the
  repeated AI fit sentence consumed too much of every collapsed Jobs row.
- The short explanation should remain available as a tooltip while the row prioritizes
  job identity information.

## Implementation

- Removed the inline `score_note` column from collapsed Jobs rows.
- Added a bounded, whitespace-normalized fit-score tooltip and an accessible label to the
  score chip without adding hundreds of non-interactive tab stops.
- Kept full scoring reasoning in the expanded details and added a full job-identity title
  tooltip for any text that still truncates on narrow screens.
- Assigned desktop role type, apply type, company assessment, duplicate location, ATS,
  skill-match, and opened badges to stable columns with empty placeholders. Wrapped row
  actions in a fixed-width rail and retained an empty archive slot where necessary.
- Recorded the durable presentation choice in ADR 0092 and updated the Jobs legend,
  product requirements, and component ownership map.

## Verification

- The tooltip regression covers whitespace normalization, unscored jobs, and bounded
  oversized notes. The layout contract verifies all seven metadata fields remain inside
  the fixed grid, the inline note is absent, and the action placeholder is retained.
- Full gates passed: 211 application tests with 9 credentialed evals skipped, 16 backend
  tests, 20 worker tests, TypeScript, documentation validation across 134 Markdown files
  and 86 ADRs, and the 33-page production build.
- The in-app browser runtime was unavailable, so final live visual confirmation remains
  with the owner after the Netlify deployment, per the agreed deployment handoff.
