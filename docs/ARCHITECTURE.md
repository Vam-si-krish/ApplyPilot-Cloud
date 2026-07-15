# Architecture — ApplyPilot-Cloud

**Current branch:** `multi-user-fork` · **Last verified:** 2026-07-15 · **Current decisions:** ADRs 0072–0085

## Current deployment topology

The application code has two deliberately separate deployment identities:

| Identity | Frontend/API routes | Persistent backend | Data boundary |
|---|---|---|---|
| ApplyPilot production (`main`) | Next.js on Netlify | Existing self-hosted Supabase-compatible stack + worker on the server laptop | Existing owner data; reserved infrastructure |
| New product (`multi-user-fork`) | Separate Netlify site/custom domain | `backend/` gateway + PostgREST + separate worker on the server laptop | Empty `jobpilot_multi` database and `backend/data/`; never production data |

The rest of this document describes the application pipeline shared by both identities.
Where it says “Supabase,” the fork uses the compatibility boundary described below; no
Supabase cloud project or Supabase backend service is involved.

## `multi-user-fork` backend

```text
Browser
  │ signed app session only
  ▼
Netlify: Next.js pages + app/api/*
  │ BACKEND_SERVICE_KEY (server-side only)
  ▼
https://vamsis-macbook-pro.tail579e6c.ts.net/jobpilot
  │ Tailscale Funnel path
  ▼
Gateway 127.0.0.1:8231
  ├─ /rest/v1/* ───────► PostgREST 127.0.0.1:8232 ─► jobpilot_multi DB
  ├─ /storage/v1/* ────► backend/data/ (HMAC signed downloads)
  └─ /worker/* ────────► résumé/LLM worker 127.0.0.1:8233
```

The fork reuses `@supabase/supabase-js` temporarily as a **wire-protocol client** so the
large, tested query surface in `lib/db.ts` and `resume-worker/supabase.js` does not need a
risky Phase 1 rewrite. `BACKEND_URL` and `BACKEND_SERVICE_KEY` take precedence over the
legacy Supabase environment names. PostgREST provides the database REST semantics; the
gateway implements only the storage operations the app uses. This is compatibility, not
a Supabase dependency.

Deployment isolation is enforced operationally:

- database/role: `jobpilot_multi` / `jobpilot_multi_app` in the shared PostgreSQL cluster;
- processes/ports: `jobpilotmulti-rest`, 8231–8233;
- public entry: Funnel path `/jobpilot` (the production Funnel root remains reserved);
- files/secrets/backups: the fork checkout's `backend/` runtime directories and `.env`;
- lifecycle: `com.jobpilotmulti.backend|worker|autopull|watchdog|backup`.

Phase 2A is implemented per ADR 0073. Three fixed server-side accounts carry stable UUIDs
in signed sessions. Middleware injects the verified UUID; the gateway converts it into a
short-lived PostgREST JWT. Forced PostgreSQL RLS then scopes every domain table even when
application code omits a filter. Files are physically namespaced by UUID and worker calls
carry the same identity. `profile.id=1` and similar singleton selectors remain for code
compatibility, but their real primary key is `user_id`, so each account has its own row.

First login leads to PDF résumé onboarding. Netlify extracts PDF text, makes one bounded
anti-fabrication parse through the owner's subscription worker, and initializes only that
user's structured résumé, explicit résumé-stated work authorization, profile facts, skills,
roles, and locations. It never infers immigration/citizenship/clearance facts. Normal work uses
keys from that user's vault or that user's UUID-isolated Claude/ChatGPT subscription connection;
deployment-level LLM/Apify fallback is disabled in the fork.

In a managed fork (`BACKEND_URL` is configured), the résumé worker URL and secret are
deployment-owned environment values. Settings cannot reveal or override them. This keeps
authenticated users from redirecting server-side worker calls and makes the trusted
Netlify → gateway → worker route explicit (ADR 0075). Legacy deployments without
`BACKEND_URL` retain their existing settings override for compatibility.

## Stack
| Layer | Choice | Role |
|---|---|---|
| Frontend + API | Next.js 14 (App Router) on Netlify | React UI + API routes in one deploy |
| Database | PostgreSQL on the server laptop | jobs, profile, settings, runs |
| Auth | Three fixed username/passwords → signed identity cookie (ADR 0073) | private multi-user gate; signup deferred |
| Job fetching | Apify actor via `apify-client` (ADR 0005) | daily last-24h fetch |
| Scoring | User-selected LLM API or UUID-isolated subscription lane | current weighted shortlist rubric |
| Scheduling | Netlify scheduled functions → `/api/run` | daily trigger (UTC) |

## The pipeline (the one control flow)
```
Netlify scheduled function (daily, UTC)
   │   Bearer CRON_SECRET
   ▼
POST /api/run
   │  • read settings (keywords, locations, hours_old, actor id)
   │  • start Apify actor run ASYNC → returns runId immediately
   │  • validate a real public callback URL before starting a billable actor
   │  • register a webhook so Apify calls us back on terminal events
   │  • insert a `runs` row (apify_run_id, launching api-key id, started_at)
   ▼
Apify runs the scrape (minutes) … then calls:
POST /api/apify-webhook
   │  • fetch the run's dataset with the same user-owned key that launched it
   │  • map → job rows, de-dupe by url, insert with status='unscored'
   │  • update the `runs` row (jobs_found)
   │  • kick off /api/score-batch
   ▼
POST /api/score-batch   (re-entrant; chunked)
   │  • select up to SCORE_BATCH_SIZE jobs WHERE status='unscored'
   │  • for each: scoreJob(resume, job) → one LLM call
   │  • persist fit_score, score_note, score_keywords, score_reasoning, scored_at, status='scored'
   │  • if unscored jobs remain → re-trigger /api/score-batch (loop)
   │  • when none remain → update `runs` (jobs_scored, finished_at)
   ▼
User visits /jobs → reads scored jobs through the configured backend, sorted by fit_score desc
```

**Why decoupled (ADR 0004):** serverless functions are short-lived. A full scrape +
score of N jobs would blow the timeout. So: Apify runs async and calls back; scoring
is chunked so no invocation exceeds the limit, re-triggering until the queue drains.

## Module boundaries
- `lib/auth.ts`, `lib/userContext.ts`, `middleware.ts` — session verification and the
  only trusted source of request identity. Caller-supplied identity headers are replaced.
- `lib/db.ts` — user-scoped data access; forced PostgreSQL RLS remains the final boundary.
- `lib/scoring.ts` — **pure** where possible: `parseScoreResponse(text)` and the prompt
  are deterministic and unit-tested. `scoreJob(resume, job)` makes the one LLM call.
- `lib/candidatePreferences.ts` — normalizes user-managed Candidate Profile preferences
  and exposes purpose-limited projections for scoring, tailoring, and ApplyBuddy.
- `lib/types.ts` + `lib/resume.ts` — own the structured résumé contract and its defensive
  normalization/text serialization boundary. Standard JSON Resume fields are extended
  with ordered `customSections`; legacy JSON without that field normalizes to an empty list.
- `components/ResumePaper.tsx`, `ResumeFields.tsx`, and `ResumeDiff.tsx` — shared browser
  résumé presentation for Base/tailored editing and contextual change review. It mirrors
  the PDF hierarchy but never owns page fitting or generated-file truth; custom sections
  use the same shared canvas and generic entry presentation.
- `lib/llm.ts` — provider abstraction + retry/back-off. Pure of business logic.
- `lib/workerConfig.ts` — resolves the trusted résumé-worker endpoint. Managed forks use
  environment values only; legacy settings fallback is isolated here.
- `lib/apify.ts` — actor start + dataset→job mapping. The only place that knows actor
  input schema; swapping actors touches only this file + the settings value. New fork
  accounts default to the pay-per-result `cheap_scraper` actor (ADR 0076); paid rental
  actors are explicit user choices. Each run pins its launching vault key because an
  Apify dataset is private to that account (ADR 0077).
- `lib/pipeline.ts` — deployment URL resolution and self-trigger helpers. Template/local
  callback targets are rejected before starting a billable Apify run (ADR 0077).
- `lib/supabase.ts` — protocol clients for the gateway/PostgREST compatibility boundary.
- `app/api/*` — thin HTTP handlers; validate input, call lib, write DB.
- `resume-worker/tailor.js`, `templates.js`, `render.js`, `supabase.js` — the hand-kept
  worker copy of résumé normalization/tailoring plus PDF and scoring serialization. Any
  résumé-shape change must update both the app and worker sides and bump `/version` features.

Settings information architecture is a presentation-only boundary (ADR 0082).
`app/(app)/settings/page.tsx` groups the existing fields into five goal-oriented views and
uses a URL hash for navigation; it does not create a second persistence model. Candidate
facts and prompt guidance remain exclusively under Candidate Profile. API keys, OAuth
connections, settings rows, RLS, and worker credentials retain their existing owners and
save semantics.

Candidate AI customization is a validated policy boundary (ADR 0083), not a user-editable
system prompt. `candidate_preferences` stores bounded scoring/tailoring choices; the API and
worker normalize them, then project only scorer or tailorer fields into that task. Current
defaults preserve the reviewed shared behavior. Direct and worker `mergeTailored` also
enforce the strict choices that are structurally decidable (preserve titles/headline and
keep the Base résumé skill list). Score parsing, rubric weights/caps, eligibility proof,
verified facts/tenure, disclosure, and one-page budgets remain protected shared contracts.

Browser résumé presentation and final PDF rendering are separate boundaries (ADR 0084).
Candidate Profile and Tailor & Apply share a responsive white-paper editor/review canvas;
the always-on worker remains the only component that measures, condenses, renders, and
guarantees the downloadable one-page PDF.

## Scoring (current v2 contract)

ADR 0022 retired exact behavioral parity with the original Lite scorer. The current
contract lives in `lib/scoring.ts` and its tests/evals:

1. Validate that the posting is a real role and apply explicit hard blockers.
2. Score must-have skills (0–60), role relevance (0–25), and experience/seniority
   (0–15). A missing core hard requirement caps the overall score at 4; a modest years
   shortfall alone does not. The account may choose a validated 0–5-year soft-gap
   tolerance, overqualification treatment, and contract-role preference without changing
   the protected weights, caps, or eligibility rules.
3. Include the posting title, company, location, metadata, and HTML-stripped description
   truncated to 15,000 characters. Company assessment is returned in the same LLM call.
4. Make one LLM call per job with `temperature: 0.1` and `maxTokens: 1000`, preserving
   the stable cacheable résumé/rubric prefix.
5. Parse and clamp the structured response. Parse/provider failure produces a visible
   score of 0; the application never fabricates a score.

The rubric is shared and owner-neutral; the candidate context is per user (ADR 0080).
`getScoringCandidateContext()` combines the RLS-scoped structured Base résumé with that
user's explicit `profile.work_authorization` plus only scorer-relevant avoidance flags,
validated trade-offs, and guidance from `candidate_preferences`. Eligibility is a hard block only when those facts
prove the candidate cannot meet the posting's condition. Explicit avoidance preferences
are also decisive; missing facts stay unknown.
`getScoringResumeText()` deliberately excludes authorization JSON because local ATS,
prefilter, and keyword matching must operate on résumé content only and cannot impose a
universal candidate-eligibility cap. The worker mirrors the
same candidate-context assembly for subscription scoring.

`status='scored'` and `fit_score` are one persistence invariant: scored always has a
numeric 0–10 result, enforced by migration 0047. Dashboards and delegated progress use
the numeric field as proof of completion, not status alone. Manual Tailor & Apply rows
remain unscored but are excluded from the automatic queue by source. Permanent provider
billing/quota failures skip retry backoff so score 0 can be persisted within the
serverless request; temporary rate limits still retry. See ADR 0079.

The labeled evals protect directional score bands and known regressions, not equality
with a retired Python implementation.

## LLM client (ported from llm.py; task routing extended in ADR 0025/0069)
- Providers by env key: Gemini (default `gemini-2.0-flash`), OpenAI (`gpt-4o-mini`),
  DeepSeek (`deepseek-chat`), Anthropic (`claude-haiku-4-5-20251001`).
- `LLM_PROVIDER` pins one; otherwise first key found wins (gemini→openai→deepseek→anthropic).
- Most providers are OpenAI-compatible (`/chat/completions`). Gemini uses the OpenAI-compat
  layer, falling back to the native `generateContent` API on 403/404 (preview models).
  Anthropic uses its own Messages API shape.
- Retry/back-off on 429/503: base 10s, double per attempt, cap 60s, respect `Retry-After`.
  Max 5 attempts, 120s timeout. (Gemini free tier 15 RPM is the binding constraint.)
- Three independent task lanes resolve complete provider/model pairs: **AI Chat**, **Tailoring**, and
  **Everything else** (scoring + classification). Claude and ChatGPT subscription pseudo-providers run
  only on the authenticated always-on worker; neither stores nor silently falls back to an API key.
- Stable cache prefixes are deliberate: scoring/tailoring keep system + résumé before the volatile job;
  ApplyBuddy keeps the cache-marked profile system block before conversation turns.
- Claude subscription login is UUID-isolated. Settings brokers Claude Code's
  official PKCE flow, and each Agent SDK call receives only the requesting
  user's `CLAUDE_CONFIG_DIR`; there is no cross-user fallback (ADR 0074).
- ChatGPT subscription login is also UUID-isolated. Settings brokers Codex's official
  device-code flow, forces file credentials under `backend/data/chatgpt-users/<uuid>`,
  and each Codex SDK call receives only that user's `CODEX_HOME` (ADR 0081).
- The direct and subscription scoring implementations share the complete persisted
  result contract: numeric fit score, explanation/breakdown, employment, company tier,
  tech stack, and usage. Worker `/version` advertises `score-company-parity` for deploy
  verification (ADR 0079).

## Data model (PostgreSQL; legacy migration directory name retained)
Field names derived from the Lite `/api/jobs` SELECT. See `supabase/migrations/`.
- Every domain row carries `user_id`; forced RLS and composite foreign keys prevent
  cross-user reads, writes, and relationships.
- **app_users / api_keys**: fixed-account identities and each user's provider vault.
- **jobs**: id, URL unique per user, title, company, location, salary, full_description,
  application_url, fit_score (0–10, null=unscored), score_note, score_keywords,
  score_reasoning, status (unscored|scored|archived), is_shortlisted, discovered_at,
  scored_at, source.
- **profile**: one row per user — personal, experience, compensation, work_authorization,
  skills_boundary, `base_resume` (the current résumé source for scoring/tailoring/ApplyBuddy),
  `candidate_preferences` (avoidance flags, recurring application answers, constrained AI
  guidance, and validated scoring/tailoring policy), legacy `resume_text` fallback, and resume_pdf_path. Candidate Profile is the
  sole ongoing editor; onboarding is initial setup only.
- **profile.base_resume / applications.tailored_resume**: user-owned JSONB `ResumeDoc`.
  Alongside basics/work/education/skills/projects it may contain `customSections[]`, each
  with a heading and ordered generic entries (`name`, `description`, `date`, `location`,
  `url`, `highlights`). JSONB makes this additive without a SQL migration; every read/write
  boundary normalizes older documents. Custom content stays inside the same forced-RLS row.
- **settings**: one row per user — schedule/search configuration plus legacy `llm_*` and the three task pairs:
  `chat_provider/model`, `tailor_provider/model`, `score_provider/model` (Everything else).
- **runs / applications / mail / messages / scoring_state**: user-owned pipeline,
  tailoring, inbox, assistant, and continuation state.

## Résumé custom-section flow

```text
Base résumé editor
  → normalizeResume → profile.base_resume JSONB
  → resumeToText / worker resumeToScoringText → ATS + AI scoring and ApplyBuddy
  → worker tailor prompt → bullet-only patch
  → mergeTailored (section/item facts anchored; bullet counts capped)
  → applications.tailored_resume → editor/change review
  → semantic HTML section → one-page PDF backstop → user-scoped storage
```

Custom sections are rendered after Projects and before Education in PDFs. The AI may
rewrite only their existing highlights; headings, entry names/descriptions, dates,
locations, and URLs are restored from the base. The condense loop and deterministic
one-page backstop include custom-entry bullets, so adding a section cannot bypass the
existing length guarantee. See ADR 0085.

## Re-trigger mechanism for chunked scoring
`/api/score-batch` re-invokes itself via a fire-and-forget `fetch` to its own URL
(`NEXT_PUBLIC_APP_URL`) with the `CRON_SECRET`, returning before the child completes.
Simple and dependency-free; if it proves fragile under load, move to a server-laptop queue
or a Netlify scheduled continuation (revisit in an ADR).

## Jobs view semantics

The all-runs Jobs view collapses duplicate content under its canonical row. Selecting a
specific run switches to that run's raw fetched rows so cross-run canonical ownership
cannot hide results. Filters are explicit and null-aware: newly fetched jobs are visible
before AI scoring, External includes an omitted `easy_apply` flag, and AI-derived filters
match only populated values. The Apify output adapter owns normalization of source filter
metadata: actor `contractType` becomes the persisted employment enum and actor `applyType`
becomes `easy_apply`, so those filters do not wait on the LLM. See ADR 0078.
