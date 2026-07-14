# PRD — ApplyPilot-Cloud

## New product direction — `multi-user-fork` (2026-07-14)

The branch is the starting point for a **new application derived from ApplyPilot**, not a
second deployment of the owner's existing app. It will eventually let multiple people
create accounts, keep their job-search data private, and use their own Apify and LLM API
keys. The frontend runs on its own Netlify site/custom domain; its persistent backend
runs on the server laptop, without Supabase or another cloud database.

### Non-negotiable isolation

- Never point the fork at ApplyPilot production environment variables, database, files,
  worker secret, or API-key rows.
- Reuse the shared PostgreSQL **cluster process** only: the fork gets its own database,
  owner role, API signing secret, storage directory, worker, ports, Funnel path, services,
  logs, and backups.
- Keep all backend service credentials server-side. A browser must never receive the
  database service key.

### Delivery phases

**Phase 1 — isolated baseline (current):** preserve the existing behavior and temporary
shared-password login while proving that an empty, independent installation can boot,
accept profile/settings/API-key data, fetch and score jobs, and generate/download files.
This phase establishes deployment, recovery, migrations, watchdog, and backups. It is
not a multi-user release and must not be opened for public signup.

**Phase 2 — multi-user product:** add account creation/login, password reset/session
management, user ownership columns and enforcement across every table/query, per-user
storage paths, per-user API-key vaults, onboarding, and worker authorization scoped to
the requesting user. Migrate singleton `id=1` profile/settings/scoring state into
user-owned records. Add abuse/rate/spend controls before public access.

**Phase 2A — fixed private accounts (current):** ship the ownership and onboarding model
first for three environment-configured username/password accounts. Public signup and
password reset remain disabled. Each account uploads a résumé PDF for AI-assisted initial
profile/search setup, then supplies its own Apify and LLM API keys for normal operation.
The owner's server subscription is permitted only for the bounded onboarding parse.

### Phase 1 acceptance criteria

1. The fork production build and tests pass without changing scoring behavior.
2. A new `jobpilot_multi` database starts from migrations with no production rows.
3. Local and public backend health checks pass through the `/jobpilot` Funnel path.
4. The separate Netlify site can log in and complete a real write/read action against
   the new database; generated files upload and download through signed URLs.
5. `com.jobpilotmulti.*` services recover after process termination and a real backup is
   produced. Existing `applypilot-*` containers, `com.applypilot.*` jobs, reserved ports,
   and the Funnel root remain untouched.

## Inherited product baseline

The sections below record the original single-owner product behavior that Phase 1 must
reproduce. The `multi-user-fork` direction and acceptance criteria above supersede its
hosting, user-count, and provisioning assumptions.

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
   A Netlify scheduled function (UTC) triggers `/api/run`.
2. On each run, **fetch the last 24h** of postings matching saved keywords × locations,
   via Apify (not local scraping). `hours_old` defaults to 24, configurable.
3. **Score every fetched job 1–10** for fit against the resume, using the **exact**
   scoring prompt + parser from `ApplyPilot-Lite/scorer.py` (see ARCHITECTURE §Scoring).
4. **Present results**: a shortlist sorted by `fit_score` desc, with filters
   (score range, search, status) and a shortlist toggle. "Run now" button for manual runs.

## Success criteria
- Given the **same resume + job description**, the TypeScript scorer produces the
  **same score and parsed fields** as the Python version (verified by `evals/cases/`).
- A manual trigger of `/api/run` results in jobs landing in the configured backend as `unscored`,
  then transitioning to `scored` with `fit_score` populated — end to end, no single
  serverless invocation exceeding the platform timeout.
- The app is unreachable without the password; the resume/profile are never public.
- The daily cron runs unattended and logs each run in the `runs` table.

## Scope of the original first build (historical)
The original build shipped Next.js code, SQL migrations, and cloud deployment docs. The
current fork scope is instead the two-phase server-laptop plan at the top of this PRD.

## Verified external facts
- Serverless function timeouts are why fetch and score remain decoupled (ADR 0004).
  Confirm current Netlify limits against official docs when changing batch design.
- Gemini free tier ≈ 15 RPM → scoring must rate-limit/back off (ported from `llm.py`).
- Apify LinkedIn job actors typically return full description + apply URL in the dataset,
  so a separate enrichment scrape is usually unnecessary; only fetch detail if
  `full_description` is missing. Verify for the chosen actor.

## Open questions / risks
- Exact Apify actor input schema varies per actor — input mapping is abstracted and the
  actor id is configurable (ADR 0005). Default: `bebity~linkedin-jobs-scraper`.
- Re-trigger mechanism for chunked scoring (self-fetch vs. queue) — see ARCHITECTURE.
