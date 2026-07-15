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

**Phase 1 — isolated baseline (complete):** preserve the existing behavior and temporary
shared-password login while proving that an empty, independent installation can boot,
accept profile/settings/API-key data, fetch and score jobs, and generate/download files.
This phase establishes deployment, recovery, migrations, watchdog, and backups. It is
not a multi-user release and must not be opened for public signup.

**Phase 2 — multi-user product:** add user ownership columns and forced enforcement
across every table/query, per-user storage paths, per-user API-key vaults, onboarding,
and worker authorization scoped to the requesting user. These foundations are now in
Phase 2A. Public account creation, password reset/session controls, encryption at rest,
and abuse/rate/spend controls remain Phase 2B gates before public access.

**Phase 2A — fixed private accounts (current):** ship the ownership and onboarding model
first for three environment-configured username/password accounts. Public signup and
password reset remain disabled. Each account uploads a résumé PDF for AI-assisted initial
profile/search setup, then supplies its own Apify/LLM API keys or connects its own
UUID-isolated Claude or ChatGPT subscription for normal work. The owner's server subscription is
permitted only for the bounded onboarding parse. Shared AI instructions are owner-neutral:
each call receives only the authenticated user's Base résumé/profile context, and onboarding
copies work-authorization facts only when the PDF states them explicitly (ADR 0080).
Candidate Profile is the single ongoing edit surface for the Base résumé, eligibility,
recurring application answers, avoidance preferences, and constrained scoring/tailoring
guidance. Its AI Guidance area also exposes validated per-user trade-offs for learnable
skills (including a 7/15/30/60-day horizon), title alignment, evidence strictness,
experience shortfalls, overqualification, and contract roles while keeping score, truth,
eligibility, and one-page contracts protected (ADRs 0081 and 0083).
Settings uses goal-oriented categories for Job Search, Automation, AI & Models,
Connections & Keys, and Advanced; only the chosen group is shown, with mobile-specific
navigation and plain-language effects/cost explanations (ADR 0082).

**Phase 2B — public-account readiness (next):** replace fixed credentials with account
creation, verified recovery, session controls, and operational account lifecycle. Encrypt
API/OAuth credentials at rest, define encrypted off-host backup handling, add rate/spend
limits and abuse monitoring, and rerun cross-user denial tests before enabling signup.

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

The sections below record the original single-owner product behavior. The
`multi-user-fork` direction and accepted ADRs supersede its hosting, user-count,
provisioning, and scoring assumptions.

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
3. **Score every fetched job 1–10** for shortlist fit using the current weighted rubric
   and parser in `lib/scoring.ts` against that account's Base résumé and explicit
   eligibility/avoidance/scoring-preference facts (see ARCHITECTURE §Scoring).
4. **Present results**: a shortlist sorted by `fit_score` desc, with filters
   (score range, search, status) and a shortlist toggle. Fresh/unscored results are
   visible without silently active score/company/run constraints; “Clear all” removes
   every filter. "Run now" button for manual runs.

## Success criteria
- Labeled résumé/job evals remain within their expected score bands and every real
  misjudgement added as a regression case continues to pass.
- A manual trigger of `/api/run` results in jobs landing in the configured backend as `unscored`,
  then transitioning to `scored` with `fit_score` populated — end to end, no single
  serverless invocation exceeding the platform timeout.
- Every UI/dashboard claim that a job is AI-scored corresponds to a persisted numeric
  `fit_score` (including visible error score 0); no account can show “Scored” with “–”.
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
  actor id is configurable (ADR 0005). The fork defaults to the pay-per-result
  `cheap_scraper~linkedin-job-scraper` (ADR 0076); paid rental actors remain optional.
- Re-trigger mechanism for chunked scoring (self-fetch vs. queue) — see ARCHITECTURE.
