# ADR 0020 — Scheduling on Netlify (not Vercel cron)

**Status:** accepted · **Date:** 2026-06-18 · **Supersedes the cron half of** [ADR 0004](0004-decoupled-pipeline.md)

## Context
The app was built assuming **Vercel Cron** (`vercel.json` → `/api/run`, `/api/gmail/sync`). The project
is actually deployed on **Netlify**, which **ignores `vercel.json`**. There was no `netlify.toml` and no
Netlify scheduled function — so the automatic daily run (and Gmail sync) **were never firing on the live
Netlify site**; runs only happened when `/api/run` was hit manually.

## Decision
Use **Netlify Scheduled Functions** as the trigger, keeping the existing decoupled pipeline unchanged.

- `netlify/functions/daily-run.mjs` — `export const config = { schedule: '0 23 * * *' }` (23:00 UTC =
  **04:30 IST**). Calls `GET /api/run` with `Authorization: Bearer CRON_SECRET`. That starts the Apify
  scrape async; the webhook → score-batch → assess-batch loops self-drive as before.
- `netlify/functions/gmail-sync.mjs` — `schedule: '*/30 * * * *'` → `GET /api/gmail/sync`.
- Functions are plain ESM (no deps) in the default `netlify/functions` dir, so Netlify auto-detects them
  alongside the `@netlify/plugin-nextjs` runtime. The inline `config.schedule` needs no `netlify.toml`.
- `lib/pipeline.ts` `appBaseUrl()` now also falls back to Netlify's `process.env.URL`, so the
  self-retriggering loops resolve the right base URL even if `NEXT_PUBLIC_APP_URL` is unset.
- `vercel.json` is kept (also set to `0 23`) only for Vercel portability; it is inert on Netlify.

## Requirements (set in the Netlify dashboard)
- **Env:** `CRON_SECRET` (authorizes the trigger) and `NEXT_PUBLIC_APP_URL` (the site URL, e.g.
  `https://applypilot.vamsikrish.com`) — the latter is what the self-retrigger loop POSTs back to.
- Scheduled functions deploy with the site; the schedule is active after the next deploy.

## Caveats / follow-ups
- **Free-plan timing:** scheduled functions fire *within* the scheduled hour, so ~04:30–05:30 IST.
- **Function timeout:** Netlify functions default to ~10s (the `maxDuration = 60` export is Vercel-only).
  The trigger itself is fast, but `/api/score-batch` does `SCORE_BATCH_SIZE` LLM calls per invocation and
  could approach the limit; if scoring stalls, lower `SCORE_BATCH_SIZE` or move heavy steps to a Netlify
  Background Function (15-min limit). Tracked as a follow-up.

## Alternatives considered
- **External cron** (cron-job.org / GitHub Actions hitting `/api/run` with the secret) — simplest, fully
  decoupled from the host; viable fallback if Netlify scheduled functions are undesirable.
- **netlify.toml-declared schedule** — equivalent; inline `config.schedule` keeps it next to the code.
