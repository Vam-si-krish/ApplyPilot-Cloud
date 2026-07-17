# Day 41 — Interview-aware mail calendar and 300-message backfill

**Date:** 2026-07-17  
**Branch:** `multi-user-fork`

## Goal

Make the global calendar clearly capture assessment windows/deadlines and scheduled
interviews, then reprocess the owner's newest 300 production emails with richer context.

## Implementation

- Added migration 0055 generalized calendar event kind/start/end fields with constraints,
  index, and assessment-date compatibility backfill.
- Expanded transient classifier input from 12,000 to 30,000 body characters and added the
  account timezone. The grounded output contract distinguishes assessment, interview,
  and no event; availability requests without a confirmed time remain off-calendar.
- Added Calendar month/week switching, colored event kinds, multi-day range display,
  upcoming details, and due-soon/overdue indicators.

## Boundaries and risk

- The owner explicitly authorized 300 billable mail-classifier calls. A production backup
  completed before the newest 300 owner-scoped rows were queued for reclassification.
- Gmail remains read-only and bodies remain transient. Only event kind/timestamps persist
  in the existing forced-RLS mail row. Production database and Netlify are the deployment
  targets; the résumé worker is unaffected.

## Pre-deployment verification

- Full app suite passes 239 tests with 9 evaluation cases intentionally skipped; backend
  passes 19/19. Classifier coverage includes scheduled interview acceptance plus
  category/date/timezone rejection.
- TypeScript, optimized production build, documentation validation (160 Markdown files,
  99 ADRs), and `git diff --check` pass. Migration, deploy, 300-message processing, and
  live calendar verification remain pending.
