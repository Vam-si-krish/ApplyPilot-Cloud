# PRD — ApplyPilot-Cloud

## What & why
A **single-user, password-protected, cloud-hosted** web app that automatically
discovers and AI-scores jobs every day, so the user opens one page each morning
to a ranked shortlist instead of running a local tool.

It is a fresh, cloud-native rewrite of the *fetch + score* half of
`../ApplyPilot-Lite/` (a Python + React app). The **only reason** for the rewrite:
ApplyPilot-Lite scrapes job boards locally with Playwright, which forces it to run
on the user's machine. Replacing local scraping with the **Apify API** turns the app
into two HTTP calls (fetch + score), so it can be **fully serverless** and self-running.

**Non-goal:** no auto-apply. The flow stops at *fetched → scored → shortlisted*.
(The original full ApplyPilot auto-applied; Lite and Cloud deliberately do not.)

## Users
One person (the owner). The app exposes the user's resume and personal data, so it
must never be publicly readable — a single shared password gates everything (ADR 0003).

## Core behaviours
1. **Daily scheduled run** (default 06:00 in the user's timezone, configurable).
   Vercel Cron (UTC) triggers `/api/run`.
2. On each run, **fetch the last 24h** of postings matching saved keywords × locations,
   via Apify (not local scraping). `hours_old` defaults to 24, configurable.
3. **Score every fetched job 1–10** for fit against the resume, using the **exact**
   scoring prompt + parser from `ApplyPilot-Lite/scorer.py` (see ARCHITECTURE §Scoring).
4. **Present results**: a shortlist sorted by `fit_score` desc, with filters
   (score range, search, status) and a shortlist toggle. "Run now" button for manual runs.

## Success criteria
- Given the **same resume + job description**, the TypeScript scorer produces the
  **same score and parsed fields** as the Python version (verified by `evals/cases/`).
- A manual trigger of `/api/run` results in jobs landing in Supabase as `unscored`,
  then transitioning to `scored` with `fit_score` populated — end to end, no single
  serverless invocation exceeding the platform timeout.
- The app is unreachable without the password; the resume/profile are never public.
- The daily cron runs unattended and logs each run in the `runs` table.

## Scope of the first build (this repo)
Deploy-ready code: Next.js app, SQL migrations, `.env.example`, README with Vercel +
Supabase setup. **Live provisioning/deploy is the user's step** — no real services are
stood up here. (Decision: session scope = "code + migrations + docs".)

## Verified external facts
- Vercel serverless/function timeouts are short (~10–60s depending on plan), which is
  why fetch and score are decoupled (ADR 0004). Confirm current limits against Vercel
  docs at deploy time.
- Gemini free tier ≈ 15 RPM → scoring must rate-limit/back off (ported from `llm.py`).
- Apify LinkedIn job actors typically return full description + apply URL in the dataset,
  so a separate enrichment scrape is usually unnecessary; only fetch detail if
  `full_description` is missing. Verify for the chosen actor.

## Open questions / risks
- Exact Apify actor input schema varies per actor — input mapping is abstracted and the
  actor id is configurable (ADR 0005). Default: `bebity~linkedin-jobs-scraper`.
- Re-trigger mechanism for chunked scoring (self-fetch vs. queue) — see ARCHITECTURE.
