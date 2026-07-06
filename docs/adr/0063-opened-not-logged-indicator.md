# 0063 — "Opened, not logged" indicator in Tailor & Apply

## Context

In Tailor & Apply you open a job's posting in a new tab, then come back. The "Did you
apply?" prompt (ADR parity with the Jobs tab) appears, but if you dismiss it with "No"
— or never see it — nothing on the row records that you already opened that posting.
Scanning a long Queue, you can't tell which jobs you've already looked at but haven't
logged an outcome for, so applications get missed or opened twice.

## Decision

Flag each row you've opened but not yet resolved, keyed off the underlying job's
existing `clicked_at` (the same field the Jobs tab's "Opened" badge uses — opening
from either tab now means the same thing, no new column).

- **Persist on open**: the row's open-posting link calls `markOpened(a)`, which stamps
  the job's `clicked_at` via `PATCH /api/jobs/[id]` (optimistically, so the state shows
  the instant you return). Skipped once already clicked or already applied.
- **Row state** `openedNotLogged = job.clicked_at && !applied_at && status !== 'applied'`:
  - a left **amber** accent rail + faint amber tint across the whole row (visible at a
    glance without hunting for a badge), and
  - an amber **"Opened"** pill next to the status, with a tooltip explaining the
    follow-up action.
- **Clears automatically** when you Mark applied (the row moves to the green applied
  state) or Set Aside (it leaves the working Queue). No manual dismissal needed.

**Colour choice**: the user suggested rose; I used amber instead. Rose is the app's
error/danger colour (weak scores, failures) and would read as "something broke". Amber
is the established "pending action / attention" accent, which is what an un-logged open
is. Emerald stays reserved for applied/done.

## Consequences

- The Queue now surfaces exactly the rows that need a decision, so opens don't get lost.
- A posting you open but genuinely skip stays amber until you Set Aside it — that's the
  intended nudge ("log an outcome or park it"), and parking is one click.
- Pure client-side derivation over data already fetched (`jobs(*)` join); no migration,
  no API shape change. A possible follow-up: a "Opened, not logged" quick-filter/count.
