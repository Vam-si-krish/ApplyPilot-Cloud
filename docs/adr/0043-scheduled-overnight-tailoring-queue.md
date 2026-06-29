# ADR 0043 — Scheduled overnight tailoring of the Tailor & Apply queue

## Status
Accepted (2026-06-29)

## Context
Tailoring a résumé is the single most expensive LLM call in the app (~6–7k input + ~3–4k
output per job; `maxTokens: 4000` in [resume-worker/tailor.js](../../resume-worker/tailor.js)),
and on a **Pro ($20) Claude subscription** the worker's Agent-SDK calls draw from the
**5-hour interactive window**, not a separate monthly Agent-SDK credit pool (this contradicts
the billing-separation premise in [ADR 0042](0042-ai-on-claude-subscription-via-agent-sdk.md) —
that separate pool is a Max-plan reality; Pro does not get it). Measured: ~16 résumés + 16
scores ≈ 36% of one window. So generating many résumés during the day both (a) competes with
the user's own interactive Claude usage and (b) risks exhausting the window mid-batch (visible
failures). The user wants to spend that usage **while asleep** (e.g. 04:00), so the window has
refreshed by morning and the résumés are ready.

The existing manual path ("Generate selected", [app/(app)/applications/page.tsx](../../app/(app)/applications/page.tsx))
runs the pipeline **in the browser** — it POSTs `/generate` per app and polls each row for up
to 3 minutes. That cannot run unattended at 4am with no browser open, and the per-resume work
(30–90s tailoring) vastly exceeds any serverless function ceiling.

## Decision
A `status: 'queued'` application with no `tailored_resume` already *is* "awaiting tailoring".
A nightly job drains that queue on the always-on worker.

- **Worker owns the batch loop.** New `POST /tailor-queue` on the worker fetches every queued
  application and runs the full pipeline **sequentially, one at a time** — tailor → render+upload
  PDF → score the tailored résumé — acking `202` first and draining in the background. Sequential
  (not concurrent) so a burst can't blow the subscription window and so the agent-client's
  per-account failover ([ADR 0042](0042-ai-on-claude-subscription-via-agent-sdk.md)) works per
  call. Each row is independent: a failure marks that row `'failed'` with a reason and the drain
  continues (chosen over stop-on-first-failure). The always-on Mac has no timeout, so the
  many-minutes drain is fine here — the same reason tailoring lives on the worker per ADR 0027.
- **The Worker Mac owns the schedule (NOT Vercel Cron).** The cloud app is deployed on
  **Netlify**, where `vercel.json` crons do **not** fire — so the scheduled trigger lives on the
  always-on Worker Mac instead. A `launchd` job (`install-tailor-queue-cron.sh` →
  `tailor-queue-trigger.sh`) fires **hourly at :00** and `curl`s the LOCAL worker's
  `POST /tailor-queue` with `{ scheduled: true }`. The worker then self-gates on the DB Settings:
  it no-ops unless `auto_tailor_enabled` AND the **current hour in `settings.timezone` matches
  `auto_tailor_time`** (DST-safe wall-clock comparison). So 23 of every 24 hourly ticks no-op and
  the one at the configured hour drains the queue — keeping the **Settings UI the single source of
  truth for the time** (change it on the web, no plist edit). `launchd` `StartCalendarInterval`
  only fires while the Mac is awake; a sleeping laptop *defers* (doesn't skip) the run, so for an
  exact 4am fire keep the Mac awake or add a `pmset` wake schedule (documented in the install script).
- **Cloud `/api/tailor-queue` is a passthrough, not the scheduler.** Its `POST` (session-gated)
  is the manual "Run queue now" button — it omits `scheduled`, so the worker bypasses the gate and
  drains immediately. Its `GET` (`checkCronAuth`) is kept as an OPTIONAL hook for a Netlify
  Scheduled Function or external cron, and forwards `scheduled: true` so the *worker* applies the
  gate (the schedule decision lives in exactly one place — the worker — never duplicated).
- **Two new settings columns** (migration 0029): `auto_tailor_enabled` (bool, default false) and
  `auto_tailor_time` ('HH:MM', default '04:00'), reusing the existing `timezone`. Surfaced in
  Settings → Daily Schedule.

## Consequences
- **Scoring discipline preserved:** the queue scores the *tailored* résumé with the same
  `scoreJobWorker` + rubric as everywhere else; a scoring failure is contained (best-effort) and
  never fabricates — it just leaves `tailored_fit_score` null.
- **Usage is shifted, not reduced.** This does not make 50 résumés/day affordable on Pro — it
  moves the spend off the user's waking hours. For volume the recommended levers remain: scoring
  on a cheap API key, tailoring on subscription or a cheap API model (see ADR 0042 / CLAUDE.md).
- **The worker is now the home of the batch loop too** (it already owned per-row tailoring). A
  crash mid-drain leaves in-flight rows `'generating'`; they're retryable (re-queue or "Generate
  selected"). The drain logs each row's outcome for post-mortem.
- **`resumeToScoringText` extracted** in supabase.js so the base-résumé scorer and the tailored
  scorer share one flatten (no drift).
