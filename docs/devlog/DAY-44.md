# Day 44 — External interview intake and recruiter reply tasks

**Date:** 2026-07-19
**Branch:** `multi-user-fork`

## Goal

Let a user paste an interview or recruiter message received outside connected Gmail,
extract its grounded job-search details with the existing AI lane, and manage the result
in Calendar alongside actionable recruiter emails.

## Boundary review

- **Caller/trust boundary:** only the signed-in browser reaches the middleware-gated
  calendar intake route; input is validated and capped before an external model call.
- **Data owner:** extracted rows remain in the current user's forced-RLS `mail_messages`
  scope. Synthetic IDs are unique only within that owner, matching Gmail de-duplication.
- **External/secrets boundary:** the route resolves only the current user's existing
  scoring/classification client. It adds no credential and never exposes a provider key.
- **Privacy:** raw pasted correspondence is transient request/model input. PostgreSQL
  stores only source provenance, summary, company, role, category, and grounded dates.
- **Runtime/deployment:** classification is one bounded serverless call. Migration 0058
  changes the isolated production backend schema; the frontend remains the production
  Netlify target from `multi-user-fork`.

## Implementation

- Added Calendar's “Add external message” panel and bounded intake API. Confirmed
  interviews/assessments join the month/week grid; recruiter outreach becomes an undated
  “Reply to recruiter” task. Both can be marked done or restored.
- Extended classification with optional company/role extraction and allowed a recruiter
  message to carry an interview only when an explicit scheduled time survives the same
  defensive timestamp parser.
- Reused `mail_messages` with `intake_source`, `company_name`, and `role_title`; raw pasted
  text is not inserted. Connected Gmail recruiter rows now share the task ledger.
- Kept completion-only confirmation mail out of new-task queries and rejected pasted text
  that does not establish a supported active item.

## Verification

- Targeted classifier and external-intake boundary tests passed (11 tests).
- Full app regression passed with 261 tests and 16 credentialed evals skipped; backend
  regression passed 19/19.
- TypeScript, the 35-page production build (including `/api/calendar/intake`), and
  documentation validation passed. Migration/deploy and live health results are recorded
  in the completion handoff.
