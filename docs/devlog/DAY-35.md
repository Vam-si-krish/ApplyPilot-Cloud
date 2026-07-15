# DAY 35 — 2026-07-15 (All jobs and AI fallback fields)

## Owner request

- Let every job move into Assign to AI, not only prepared External Apply rows.
- Let the extension fill first, then let AI complete missed fields from known candidate
  information.
- When the answer is unknown, mark Needs review, leave the tab aside, and continue with
  the next job in a new tab. Keep the instructions short.

## Implementation

- Expanded assignment to every unapplied row with a usable HTTP(S) link, including Easy
  Apply, LinkedIn, queued, ungenerated, and missing-PDF rows.
- Removed the five-active-row queue cap. The copied prompt processes the next twenty
  assigned jobs while all remaining rows stay in the queue.
- Added concise known-fact fallback filling from Candidate Profile, saved application
  answers, résumé, and cover letter.
- Relabeled blockers as Needs review and instructed the browser run to record the missing
  field, leave the tab open, and continue in a new tab.
- Recorded the amended product boundary in ADR 0095.

## Verification

- Focused eligibility, lifecycle, route, prompt, and UI-contract tests plus TypeScript
  pass.
- Full gates pass: 218 application tests with 9 credentialed evals skipped, 16 backend
  tests, 20 worker tests, TypeScript, documentation validation across 141 Markdown files
  and 89 ADRs, and the production-mode Next.js build.
- The isolated development server verified application commit `429d90d` with a healthy
  gateway/worker and clean checkout. Its push triggered the normal development Netlify
  build; it was not polled, per the owner handoff. Production remains untouched.
