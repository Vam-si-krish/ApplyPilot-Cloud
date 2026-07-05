# ADR 0061 — "Set Aside" tab + auto-download PDFs on opening a posting

## Status
Accepted (2026-07-05)

## Context
Two workflow gaps in Tailor & Apply:
1. The Queue mixes what the user is actively working with rows they've deliberately
   deferred — Easy Apply jobs they'll batch later, applications they started but couldn't
   finish. Those rows "take up space" and add noise to every scan of the list.
2. Applying via an external portal means: open the posting, then come back, find the row,
   download the résumé PDF, (maybe) the cover letter, then upload them on the portal.
   That's three round-trips per job, dozens of times a day.

## Decision
**Set Aside tab.** A `parked boolean` on `applications` (migration 0039). Parked rows keep
ALL state (résumé, PDF, cover letter, status, applied flag) — parking only changes where
they appear: the Queue shows `parked=false`, the new Set Aside tab (with a count badge)
shows `parked=true`. Per-row folder-in/folder-out buttons and a bulk "Set aside" / "Move to
Queue" action move rows between them. The overnight drain and the "Run queue now" count
exclude parked rows — set-aside means *not now*, so the scheduler must not spend LLM calls
on them until they're moved back. A tab (not a status) because parking is orthogonal to the
pipeline status — a queued, ready, or applied row can all be set aside.

**Auto-download on open.** A per-browser toggle ("Auto-download on open", persisted in
localStorage like the Jobs tab's filter preference — it's a device preference, not app
state). When ON, clicking a row's open-posting link also fires the existing signed-URL
downloads for that job's résumé PDF and cover-letter PDF while the posting opens. Because
the download hangs off the same click, **Ctrl/Cmd-clicking several rows' links opens them
all in background tabs and downloads each job's PDFs as you go** — the UI says so in a hint
line when the toggle is on (plus: allow the browser's "multiple downloads" prompt once).

## Consequences
- The Queue is a true working set; deferred work is one tab away with nothing lost.
- Portal applications become: toggle once, click the link, everything needed is in the
  Downloads folder by the time the portal form loads.
- The worker's `getQueuedApplications` now filters `parked=false` — needs the Worker Mac
  redeploy; until then the drain simply ignores the column (old query), which only means
  parked queued rows could still be tailored overnight — benign, nothing breaks.
- Migration 0039 applied to the live DB (default false; zero behavior change for existing rows).
