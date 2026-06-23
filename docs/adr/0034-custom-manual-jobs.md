# ADR 0034 — Add custom (manually-entered) jobs

## Status
Accepted (2026-06-23)

## Context
Every job in the app came from the Apify scraper. But the user often hears about roles
outside that pipeline — most commonly a recruiter **email** — and wants to tailor a résumé
to one of those without it existing as a scraped row. There was no way to enter a job by
hand; the only manual path (the "Quick Generate" tab) is ephemeral (paste a JD → download a
PDF) and doesn't create a tracked application.

## Decision
Add a first-class "custom job" that flows through the normal Tailor & Apply pipeline.

- **DB (`createCustomApplication`)** inserts a `jobs` row + an `applications` row in one step.
  Only **title + description are required**; **company and link are optional** (per the
  request). `jobs.url` is `not null unique`, so a synthetic internal url (`manual:<uuid>`) is
  always used and the user's link, if any, goes in `application_url` — no collision with
  scraped rows. The job is flagged `source='manual'` and `status='scored'` (with no
  `fit_score`) so the scoring loop ignores it. No migration (reuses existing columns).
- **Route** `POST /api/applications/custom` validates title + description and returns the new
  application joined with its job.
- **Jobs list** (`/api/jobs`) now excludes `source='manual'` (`source.is.null,source.neq.manual`)
  so manual jobs live only under Tailor & Apply, not the scraped Jobs list.
- **UI** — an "Add custom job" button + inline form on the Tailor & Apply tab (title required,
  company/link optional, description textarea). On submit the new application appears in the
  list and is tailored/rendered/applied exactly like a scraped one.

## Consequences
- The user can paste a job from an email and generate a tailored résumé for it, with full
  tracking (status, PDF, applied) — same flow, same one-page + human-voice tailoring
  (ADR 0031/0033).
- Manual jobs are invisible in the scraped Jobs list and skip scoring/auto-assess; they carry
  no fit/skill signals, so tailoring runs on the description alone (signals default to N/A —
  already handled by `buildTailorMessages`).
- Deleting a custom application leaves its (hidden) job row orphaned — harmless, but a future
  cleanup could delete the manual job alongside it.
- App-side only → goes live on the next Netlify deploy; no worker change.
