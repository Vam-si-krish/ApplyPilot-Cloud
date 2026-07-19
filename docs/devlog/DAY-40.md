# Day 40 — Focused application flow and assessment calendar

**Date:** 2026-07-16  
**Branch:** `multi-user-fork`

## Goal

Simplify Jobs and Tailor & Apply, make AI Apply opt-in, support target-location résumé
copies, and turn dated assessment emails into a usable calendar.

## Implementation

- Removed the Jobs Filtered tab and duplicate Tailor & Apply queue runner; promoted Apply
  to a labeled primary row action while keeping Queue as the default view.
- Added default-off `settings.ai_apply_enabled`; the client, assignment API, and MCP queue
  enforce it. Added a default-off Candidate Profile toggle that changes only newly
  tailored copies to the job's listed location, with matching app/worker behavior.
- Added transient bounded Gmail-body reading for classification, grounded assessment
  start/end parsing, migration 0054 date storage/index/ordering constraint, a user-scoped
  calendar API, and the Assessment Calendar screen/navigation.

## Boundaries and risk

- Data owner is the authenticated user's forced-RLS settings/profile/mail/application
  rows. Callers are the session-gated browser routes, the per-user worker context, and a
  valid user-bound MCP token. Production database, Netlify production, and the production
  résumé worker are the deployment targets.
- Gmail remains read-only. Up to 12,000 body characters enter the selected mail-classifier
  provider transiently and are never stored; persisted calendar data is limited to two
  timestamps on the existing email row. Invalid/reversed dates are discarded.
- Migration is additive/default-off. Existing Base résumés and AI assignment rows are not
  rewritten. A production backup is required before applying it.

## Pre-deployment verification

- Full app suite passes 238 tests with 9 evaluation cases intentionally skipped; backend
  passes 19/19 and résumé-worker passes 21/21, including generated-copy location isolation.
- TypeScript, optimized production build, documentation validation (158 Markdown files,
  98 ADRs), and `git diff --check` pass.
- The production backup completed before migration. Browser visual QA was unavailable
  because this session exposed no browser backend; migration/deploy, worker feature check,
  and live authenticated route/health smokes remain pending.
