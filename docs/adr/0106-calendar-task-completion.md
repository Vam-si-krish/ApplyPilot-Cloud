# ADR 0106: Calendar task completion and confirmation reconciliation

- Status: accepted
- Date: 2026-07-17
- Amends: ADR 0105 mail calendar interviews and week view

## Context

The mail calendar needs to operate as a task list, not only a date display. Users must be
able to mark an assessment or interview done, restore it, and trust explicit completion
emails to close the correct existing event without broad keyword guesses.

## Decision

- Persist nullable `calendar_completed_at` and completion provenance (`user` or `email`)
  on the existing forced-RLS mail event row.
- Add a session-gated, user-scoped PATCH route for manual mark-done/mark-active actions.
- Extend mail classification with `EVENT_ACTION`. `complete` requires explicit proof that
  an assessment was finished/submitted or an interview happened; invitations, reminders,
  application confirmations, and availability requests never count.
- Reconcile completion to an active event by a unique Gmail thread first. Otherwise
  require a strong, unique sender-domain plus subject/summary token match. Ambiguous
  candidates remain active for manual review.
- Present Active and Done task ledgers alongside the calendar, with reversible controls
  and visible email-confirmed provenance.

## Consequences

Completion is durable and user-controlled while conservative email automation removes
confirmed work. A completion email that cannot be matched safely has no destructive
effect. Calendar events remain traceable to their source Gmail message.
