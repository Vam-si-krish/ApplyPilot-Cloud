# Architecture — ApplyPilot-Cloud

**Current branch:** `multi-user-fork` · **Last verified:** 2026-07-14 · **Current decisions:** ADRs 0072–0075

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
user's structured résumé, profile facts, skills, roles, and locations. Normal work uses
keys from that user's vault or that user's UUID-isolated Claude subscription connection;
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
   │  • register a webhook so Apify calls us back on SUCCEEDED
   │  • insert a `runs` row (apify_run_id, started_at)
   ▼
Apify runs the scrape (minutes) … then calls:
POST /api/apify-webhook
   │  • fetch the run's dataset items
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
- `lib/llm.ts` — provider abstraction + retry/back-off. Pure of business logic.
- `lib/workerConfig.ts` — resolves the trusted résumé-worker endpoint. Managed forks use
  environment values only; legacy settings fallback is isolated here.
- `lib/apify.ts` — actor start + dataset→job mapping. The only place that knows actor
  input schema; swapping actors touches only this file + the settings value.
- `lib/supabase.ts` — protocol clients for the gateway/PostgREST compatibility boundary.
- `app/api/*` — thin HTTP handlers; validate input, call lib, write DB.

## Scoring (current v2 contract)

ADR 0022 retired exact behavioral parity with the original Lite scorer. The current
contract lives in `lib/scoring.ts` and its tests/evals:

1. Validate that the posting is a real role and apply explicit hard blockers.
2. Score must-have skills (0–60), role relevance (0–25), and experience/seniority
   (0–15). A missing core hard requirement caps the overall score at 4; a modest years
   shortfall alone does not.
3. Include the posting title, company, location, metadata, and HTML-stripped description
   truncated to 15,000 characters. Company assessment is returned in the same LLM call.
4. Make one LLM call per job with `temperature: 0.1` and `maxTokens: 1000`, preserving
   the stable cacheable résumé/rubric prefix.
5. Parse and clamp the structured response. Parse/provider failure produces a visible
   score of 0; the application never fabricates a score.

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
  skills_boundary, resume_text (scoring reads this), resume_pdf_path.
- **settings**: one row per user — schedule/search configuration plus legacy `llm_*` and the three task pairs:
  `chat_provider/model`, `tailor_provider/model`, `score_provider/model` (Everything else).
- **runs / applications / mail / messages / scoring_state**: user-owned pipeline,
  tailoring, inbox, assistant, and continuation state.

## Re-trigger mechanism for chunked scoring
`/api/score-batch` re-invokes itself via a fire-and-forget `fetch` to its own URL
(`NEXT_PUBLIC_APP_URL`) with the `CRON_SECRET`, returning before the child completes.
Simple and dependency-free; if it proves fragile under load, move to a server-laptop queue
or a Netlify scheduled continuation (revisit in an ADR).
