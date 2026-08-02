# PRD — ApplyPilot-Cloud

## New product direction — `multi-user-fork` (2026-07-14)

The branch is the starting point for a **new application derived from ApplyPilot**, not a
second deployment of the owner's existing app. It will eventually let multiple people
create accounts, keep their job-search data private, and use their own Apify and LLM API
keys. The frontend runs on its own Netlify site/custom domain; its persistent backend
runs on the server laptop, without Supabase or another cloud database.

### Non-negotiable isolation

- Never point the fork at, continuously share, or synchronize with ApplyPilot production
  environment variables, database, files, worker, or secrets.
- ADR 0087 is the only approved cutover exception: the owner explicitly authorized one
  verified snapshot of their own rows, user API/Gmail connections, and available files
  into the fixed `vamsi` UUID. Deployment worker credentials were excluded, and the fork
  remains independent after the recorded cutoff.
- Reuse the shared PostgreSQL **cluster process** only: the fork gets its own database,
  owner role, API signing secret, storage directory, worker, ports, Funnel path, services,
  logs, and backups.
- Keep all backend service credentials server-side. A browser must never receive the
  database service key.
- Keep the server laptop unattended: personal-laptop development hands off code through
  the protected branch, with an optional Tailscale-only forced-command key for immediate
  isolated-service operations. Do not expose a public deployment/restart webhook or place
  server/app secrets in GitHub Actions (ADR 0088).
- Treat `multi-user-fork` as production and `develop` as the pre-production integration
  branch. Development must use its own empty database, role, services, files, secrets,
  backups, and public path; local test success alone does not authorize production
  deployment (ADR 0089).
- ADR 0091 is the only development credential-copy exception: at the owner's explicit
  request, a guarded one-shot script may copy only that owner's `api_keys` rows and add
  synthetic fixtures. It does not copy profile/history/files/OAuth/login/backend secrets
  and does not synchronize later changes.

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
for five production environment-configured username/password accounts. Public signup and
password reset remain disabled. Each account uploads a résumé PDF for AI-assisted initial
profile/search setup, then supplies its own Apify/LLM API keys or connects its own
UUID-isolated Claude or ChatGPT subscription for normal work. The owner's server subscription is
permitted only for the bounded onboarding parse. Shared AI instructions are owner-neutral:
each call receives only the authenticated user's Base résumé/profile context, and onboarding
copies work-authorization facts only when the PDF states them explicitly (ADR 0080).
Returning accounts whose onboarding is complete go directly to Dashboard. If the account
status API is unreachable, the UI must report a temporary workspace connection failure
and must not present résumé upload as though the account were new (ADR 0109).
Candidate Profile is the single ongoing edit surface for the Base résumé, eligibility,
recurring application answers, avoidance preferences, and constrained scoring/tailoring
guidance. Its AI Guidance area also exposes validated per-user trade-offs for learnable
skills (including a 7/15/30/60-day horizon), title alignment, evidence strictness,
experience shortfalls, overqualification, and contract roles while keeping score, truth,
eligibility, and one-page contracts protected (ADRs 0081 and 0083).
The Base résumé editor and Tailor & Apply editor/change review use the same responsive,
print-like white document hierarchy as the downloaded résumé. The worker-rendered PDF
remains the final one-page layout authority (ADR 0084).
Tailor & Apply carries each job's Easy Apply or External Apply type into its row and
filters, and every completed local ATS recheck shows the method-identical Base-to-tailored
comparison even when the score is unchanged (ADR 0090).
Jobs keeps collapsed rows scan-friendly: the repeated AI fit note does not occupy a
dedicated column. It remains available from the fit-score tooltip, while complete scoring
reasoning stays in the expanded job details. On desktop, role type, apply type, company
assessment, duplicate locations, ATS match, skill match, and opened state each retain a
stable column, and row actions retain fixed icon slots (ADR 0092).
Each posting company is assessed once by AI on two axes — who actually receives the
application (direct employer, staffing, aggregator repost, talent-pool marketplace, gig
platform) and employer trust — cached per company, stamped onto its jobs, and shown as
a badge with the reason. A default-on "Hide time-wasters" filter removes
aggregator/talent-pool/gig-platform reposts and suspicious employers while never hiding
companies that haven't been assessed yet; verdicts are correctable per company from the
job details and corrections persist across future runs (ADR 0107).
Tailor & Apply also provides an opt-in AI Apply Navigator, disabled by default and enabled
from Settings. Every unapplied job with a valid
web link may enter the AI queue regardless of Easy Apply/External type or document
readiness. The extension fills first; AI completes missed fields from Candidate Profile,
saved application answers, résumé, or cover letter, navigates and submits, then records
visible success. If the exact employer-site job visibly says the user already applied,
AI must not resubmit it and instead reconciles the ApplyPilot application and linked job
to Applied. If the answer or completion state is uncertain, the job becomes Needs review, its tab
stays open, and AI continues with the next job in a new tab. Assignment is uncapped.
The preferred path is now a bundled ApplyPilot Codex plugin: six MCP tools
read the live assigned queue, retrieve one active row's grounded context only when
needed, pair the local process without exposing a bearer token, and record lifecycle
outcomes. Access is a revocable, user-bound two-hour run obtained through a ten-minute,
single-use code; the AI Apply header shows queue health and connection state, while
the existing next-twenty copied prompt remains a fallback during rollout (ADRs
0093–0096 and 0099–0102). The installed plugin targets production by default; development
is an explicit endpoint override.

Jobs presents Apply as the primary row action and omits the internal Filtered status tab.
Tailor & Apply opens to Queue and uses Generate selected as its single manual batch action.
Candidate Profile can opt newly tailored copies into the job's listed location while
leaving the Base résumé unchanged. Mail classification records explicit assessment
windows/deadlines and confirmed interview times in a dedicated month/week calendar;
undated or unscheduled non-recruiter messages remain in Inbox only. The Calendar accepts
up to 30,000 characters pasted from another email account, SMS, or chat and uses the
existing per-user classification lane to extract grounded company, role, and schedule
details without storing the raw paste. Connected or pasted recruiter outreach becomes a
reply task but stays off the date grid unless it contains a confirmed interview time.
Inbox Sync drains pending mail through provider-aware chunks and reports success only
after the pending count reaches zero; slower subscription calls run one per web request
so the browser receives progress before the serverless timeout.
Calendar work forms a reversible Active/Done task ledger; explicit, safely matched
completion emails may mark the source event done automatically (ADRs 0104–0106, 0108,
and 0116).
Settings uses goal-oriented categories for Job Search, Automation, AI & Models,
Connections & Keys, and Advanced; only the chosen group is shown, with mobile-specific
navigation and plain-language effects/cost explanations (ADR 0082).
Each user's structured base résumé may also contain ordered, user-named sections such as
Additional Experience, Certifications, Leadership, Publications, and Awards. Those
sections use the same white document hierarchy and participate in scoring, tailoring,
review, and the downloaded PDF without crossing the user's existing row/file boundary
(ADR 0085).
Tailoring accepts a model response only through the protected structured parser. A
literal paragraph break inside an otherwise-valid quoted JSON value is repaired without
making the user rerun a paid generation; other malformed structure still fails visibly
instead of being guessed (ADR 0086).
The fixed `vamsi` account is populated from the one-time owner snapshot in ADR 0087,
including profile, settings, job/application/mail history, user-owned provider keys,
Gmail state, and every physical résumé object available at the source. This is an account
cutover, not a bridge to the original deployment; new activity belongs only to the fork.

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

**Historical non-goal:** the original baseline had no auto-apply and stopped at
*fetched → scored → shortlisted*. ADRs 0093–0095 amend that baseline with a user-invoked
application navigation run across all linked jobs. The app still does not silently
launch a native browser executor or invent candidate information it does not have.

## Users
One person (the owner). The app exposes the user's resume and personal data, so it
must never be publicly readable — a single shared password gates everything (ADR 0003).

## Core behaviours
1. **Daily scheduled run** (default 06:00 in the user's timezone, configurable).
   A Netlify scheduled function (UTC) triggers `/api/run`.
2. On each run, **fetch the last 24h** of postings matching saved keywords × locations,
   via Apify (not local scraping). `hours_old` defaults to 24, configurable. The
   URL-driven LinkedIn actor keeps up to 20 searches in a saved library and fetches any
   user-selected active subset together; overlapping searches do not create repeated
   job-URL rows, and same-day duplicate postings remain collapsed under one Jobs row.
3. **Score every fetched job 1–10** for shortlist fit using the current weighted rubric
   and parser in `lib/scoring.ts` against that account's Base résumé and explicit
   eligibility/avoidance/scoring-preference facts (see ARCHITECTURE §Scoring).
4. **Present results**: a shortlist sorted by `fit_score` desc, with filters
   (score range, search, status) and a shortlist toggle. Fresh/unscored results are
   visible without silently active score/company/run constraints. Applied jobs and jobs
   already in Tailor & Apply are hidden by default, posting-by-posting; an eligible
   duplicate location remains visible even when its original canonical row is hidden.
   “Select all matching” obeys the same hide rules, and Jobs deletion cannot remove a
   linked Tailor & Apply row; that application must be removed deliberately from its own
   surface first. “Clear all” removes every filter. "Run now" button for manual runs.
5. **Maintain one complete résumé:** the Base résumé editor supports both the standard
   résumé fields and user-defined sections. Custom sections remain editable in a tailored
   copy, are included in AI/local scoring context, preserve user-entered facts during AI
   rewriting, and render as semantic single-column sections in the one-page PDF.
6. **Complete valid tailoring work without manual retries:** harmless raw paragraph breaks
   inside a model's otherwise-valid JSON string are recovered deterministically. The app
   never invents missing JSON structure or bypasses Base-résumé fact anchoring.

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
- Exact Apify actor input/output schema and price vary per actor. LinkedIn integrations
  are registered adapters that own those contracts and their cost estimate (ADR 0113).
  The fork defaults to criteria-driven `cheap_scraper~linkedin-job-scraper` (ADR 0076);
  the opt-in Curious Coder adapter accepts reusable filtered LinkedIn Jobs search URLs.
- Re-trigger mechanism for chunked scoring (self-fetch vs. queue) — see ARCHITECTURE.
