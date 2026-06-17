# Architecture — ApplyPilot-Cloud

## Stack
| Layer | Choice | Role |
|---|---|---|
| Frontend + API | Next.js 14 (App Router) on Vercel | React UI + API routes in one deploy |
| Database | Supabase Postgres | jobs, profile, settings, runs |
| Auth | Shared password → signed cookie (ADR 0003) | single-user gate |
| Job fetching | Apify actor via `apify-client` (ADR 0005) | daily last-24h fetch |
| Scoring | LLM API, default Gemini `gemini-2.0-flash` | port of Lite `scorer.py` |
| Scheduling | Vercel Cron → `/api/run` | daily trigger (UTC) |

## The pipeline (the one control flow)
```
Vercel Cron (daily, UTC)
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
User visits /jobs → reads scored jobs from Supabase, sorted by fit_score desc
```

**Why decoupled (ADR 0004):** serverless functions are short-lived. A full scrape +
score of N jobs would blow the timeout. So: Apify runs async and calls back; scoring
is chunked so no invocation exceeds the limit, re-triggering until the queue drains.

## Module boundaries
- `lib/scoring.ts` — **pure** where possible: `parseScoreResponse(text)` and the prompt
  are deterministic and unit-tested. `scoreJob(resume, job)` makes the one LLM call.
- `lib/llm.ts` — provider abstraction + retry/back-off. Pure of business logic.
- `lib/apify.ts` — actor start + dataset→job mapping. The only place that knows actor
  input schema; swapping actors touches only this file + the settings value.
- `lib/supabase.ts` — `supabaseAdmin()` (service-role, server-only) and
  `supabaseBrowser()` (anon). API routes and server components use admin; client uses anon.
- `app/api/*` — thin HTTP handlers; validate input, call lib, write DB.

## Scoring (replicated exactly from ApplyPilot-Lite)
Source: `../ApplyPilot-Lite/src/applypilot/scoring/scorer.py`.
1. `SCORE_PROMPT` copied verbatim (expert Talent Acquisition Strategist; PHASE 1 content
   validation; PHASE 2 alignment; 0–10 rubric; strict `SCORE/KEYWORDS/NOTE/REASONING` format).
2. User message: `RESUME:\n{resume}\n\n---\n\nJOB POSTING:\nTITLE/COMPANY/LOCATION/DESCRIPTION`,
   description truncated to **6000 chars**.
3. LLM call with `temperature: 0.2`, `max_tokens: 512`.
4. Parser: line-prefixed `SCORE:`/`KEYWORDS:`/`NOTE:`/`REASONING:`; score clamped to 0–10;
   `0` = invalid content / not a real job description. LLM error → score 0 (visible).

> Lite stored `score_reasoning` as `"{keywords}\n{reasoning}"` combined. Cloud keeps
> **`score_keywords` and `score_reasoning` as separate columns** (per the brief's data
> model); the parser still returns all four fields.

## LLM client (ported from llm.py)
- Providers by env key: Gemini (default `gemini-2.0-flash`), OpenAI (`gpt-4o-mini`),
  DeepSeek (`deepseek-chat`), Anthropic (`claude-haiku-4-5-20251001`).
- `LLM_PROVIDER` pins one; otherwise first key found wins (gemini→openai→deepseek→anthropic).
- Most providers are OpenAI-compatible (`/chat/completions`). Gemini uses the OpenAI-compat
  layer, falling back to the native `generateContent` API on 403/404 (preview models).
  Anthropic uses its own Messages API shape.
- Retry/back-off on 429/503: base 10s, double per attempt, cap 60s, respect `Retry-After`.
  Max 5 attempts, 120s timeout. (Gemini free tier 15 RPM is the binding constraint.)

## Data model (Supabase Postgres)
Field names derived from the Lite `/api/jobs` SELECT. See `supabase/migrations/`.
- **jobs**: id, url (unique), title, company, location, salary, full_description,
  application_url, fit_score (0–10, null=unscored), score_note, score_keywords,
  score_reasoning, status (unscored|scored|archived), is_shortlisted, discovered_at,
  scored_at, source.
- **profile**: single row — personal, experience, compensation, work_authorization,
  skills_boundary, resume_text (scoring reads this), resume_pdf_path.
- **settings**: single row — schedule_time, timezone, keywords[], locations[], hours_old
  (24), results_per_query, llm_provider, llm_model, apify_actor_id.
- **runs**: id, started_at, finished_at, jobs_found, jobs_scored, errors, apify_run_id, status.

## Re-trigger mechanism for chunked scoring
`/api/score-batch` re-invokes itself via a fire-and-forget `fetch` to its own URL
(`NEXT_PUBLIC_APP_URL`) with the `CRON_SECRET`, returning before the child completes.
Simple and dependency-free; if it proves fragile under load, swap to a Supabase queue or
Vercel cron tick (revisit in an ADR).
