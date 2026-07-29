# ADR 0114 — Protect Tailor & Apply state from Jobs deletion

**Status:** accepted · **Date:** 2026-07-28 · **Amends:** ADR 0101

## Context

Jobs hides applied postings and Tailor & Apply members posting-by-posting. The paginated
list applied those hide rules after loading rows, but the `idsOnly` branch used by
“Select all matching” returned early. It therefore included hidden UUIDs in bulk actions.
Deleting one of those jobs followed the existing application foreign key's `ON DELETE
CASCADE`, silently deleting the Tailor & Apply row and its résumé-generation state.

## Decision

- Apply the same applied/Tailor & Apply hide predicates before `idsOnly` returns bulk
  selection IDs.
- Treat Tailor & Apply membership as a hard deletion boundary, not only a presentation
  filter. `DELETE /api/jobs/[id]` returns `409` when an application references the job.
  The user must deliberately remove the Tailor & Apply application first.
- Bulk deletion reports protected rows separately and never claims a rejected deletion
  succeeded.
- Keep a bounded production recovery command for one to ten application UUIDs. It
  validates every UUID, finds the newest retained backup containing all requested rows,
  extracts only the selected application and linked-job `COPY` records, previews by
  default, and writes only after an explicit apply command.

## Consequences

Hidden rows cannot re-enter bulk selection, and stale browser state cannot bypass the
server-side application guard. The database cascade remains useful for deliberate
application-first cleanup, but the Jobs surface can no longer invoke it accidentally.
Recovery remains an exceptional, audited operator action rather than an end-user API.

## Verification

Cover the initial hide state, `idsOnly` predicate application, delete-route guard ordering,
restricted-command validation, app/backend tests, type checking, production build,
documentation validation, production backup preview, exact two-row restore, and
post-restore counts.
