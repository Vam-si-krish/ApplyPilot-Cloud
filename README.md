# ApplyPilot-Cloud

A single-user, password-protected web app that **runs itself daily in the cloud**:
it fetches the last 24 hours of job postings (via Apify), scores each **1–10** for
fit against your resume (via an LLM), and shows a ranked, filterable shortlist.
**It does not auto-apply** — the flow stops at *fetched → scored → shortlisted*.

It is a cloud-native rewrite of the *fetch + score* half of
[`ApplyPilot-Lite`](../ApplyPilot-Lite), replacing local Playwright scraping with the
Apify API so the whole thing can run serverless. **Scoring behaviour is copied
exactly** from ApplyPilot-Lite (same prompt, same parser, same model defaults) — see
[How scoring mirrors ApplyPilot-Lite](#how-scoring-mirrors-applypilot-lite).

## Stack
- **Next.js 14 (App Router)** on Vercel — React UI + API routes in one deploy
- **Supabase Postgres** — jobs, profile, settings, runs
- **Apify** — daily job fetch (configurable actor, default `bebity~linkedin-jobs-scraper`)
- **LLM scoring** — Gemini `gemini-2.0-flash` by default (OpenAI / DeepSeek / Anthropic supported)
- **Vercel Cron** — triggers the daily run
- Auth: a single shared password → signed session cookie

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full pipeline and
[`docs/adr/`](docs/adr) for the decisions behind it.

## How it works (the pipeline)
```
Vercel Cron (daily, UTC) ─▶ GET /api/run          start Apify actor ASYNC + webhook
Apify finishes scrape    ─▶ POST /api/apify-webhook ingest jobs → status 'unscored'
                         ─▶ POST /api/score-batch   score N jobs/call, re-trigger until drained
You open /jobs           ─▶ read scored jobs, sorted by fit score
```
Fetch and score are decoupled so no single serverless invocation exceeds the
function timeout (ADR 0004).

## Prerequisites
- Node 20+, a [Supabase](https://supabase.com) project, an [Apify](https://apify.com)
  account + token, and one LLM API key (Gemini recommended; free tier works).

## Local development
```bash
npm install
cp .env.example .env.local      # then fill in the values (see below)
```

1. **Create the database schema.** In the Supabase dashboard → SQL Editor, run
   [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql). It creates
   the `jobs`, `profile`, `settings`, and `runs` tables and seeds the single profile/settings rows.
2. **Fill `.env.local`** (all keys documented in [`.env.example`](.env.example)):
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
   - `APP_PASSWORD` (the login password) and `AUTH_SECRET` (`openssl rand -hex 32`)
   - `APIFY_TOKEN`, optionally `APIFY_ACTOR_ID`
   - `CRON_SECRET` (`openssl rand -hex 32`)
   - one LLM key, e.g. `GEMINI_API_KEY`
   - `NEXT_PUBLIC_APP_URL=http://localhost:3000`
3. **Run it:**
   ```bash
   npm run dev          # http://localhost:3000  → log in with APP_PASSWORD
   ```
4. Go to **Profile** and paste your résumé text (this is what scoring reads), then
   **Settings** to set keywords/locations. Hit **Run now** on the Dashboard to kick a run.

### Commands
```bash
npm run dev          # dev server
npm run build        # production build
npm run typecheck    # tsc --noEmit
npm run test         # vitest: scoring parser, provider detection, evals
npm run lint         # next lint
```

### Evals
[`evals/cases/*.json`](evals/cases) hold labeled résumé+job cases with expected score
bands. `npm run test` validates their structure always, and — when an LLM key is in the
environment — scores them live and asserts each lands in band. Add a case whenever you
find a real misjudgement; it becomes a permanent regression check.

## Deploying

### Supabase
1. Create a project. Run `supabase/migrations/0001_init.sql` in the SQL Editor.
2. Copy the Project URL and the `anon` + `service_role` keys (Project Settings → API).

### Vercel
1. Import the repo into Vercel.
2. Add **Environment Variables** (Project Settings → Environment Variables) — every key
   from `.env.example`. Set `NEXT_PUBLIC_APP_URL` to your deployment URL
   (e.g. `https://your-app.vercel.app`) so the Apify webhook and score-batch self-trigger
   resolve correctly.
3. Deploy. [`vercel.json`](vercel.json) registers the daily cron on `/api/run`.

### Scheduling note (cron is UTC)
`vercel.json` runs the cron at `0 10 * * *` (10:00 UTC). The schedule is **UTC** — convert
your desired local time yourself (e.g. 06:00 America/New_York = 10:00 or 11:00 UTC depending
on DST). The Settings page stores your intended local time/timezone for reference, but the
authoritative trigger time is the cron expression in `vercel.json`. When `CRON_SECRET` is set,
Vercel sends it as a Bearer token, which `/api/run` verifies.

## How scoring mirrors ApplyPilot-Lite
The scorer is a faithful TypeScript port of
`../ApplyPilot-Lite/src/applypilot/scoring/scorer.py`:
- **`SCORE_PROMPT`** (the "expert Talent Acquisition Strategist" prompt with PHASE 1 content
  validation, PHASE 2 alignment, the 0–10 rubric, and the strict
  `SCORE / KEYWORDS / NOTE / REASONING` format) is copied verbatim into
  [`lib/scoring.ts`](lib/scoring.ts).
- The user message is built identically — résumé + job, **description truncated to 6000 chars**.
- The LLM call uses **`temperature: 0.2`, `max_tokens: 512`**.
- The response is parsed identically: line-prefixed fields, score clamped to **0–10**, where
  **0 means "invalid content / not a real job description."** Any LLM error yields score 0
  (visible), never a fabricated score.

The LLM client ([`lib/llm.ts`](lib/llm.ts)) ports `llm.py`: provider auto-detection by env key
(Gemini default), the OpenAI-compatible call path with the Gemini compat→native fallback, the
Anthropic Messages shape, and 429/503 + timeout retry with exponential back-off.

One intentional difference: ApplyPilot-Lite stored keywords folded into `score_reasoning`;
Cloud keeps **`score_keywords` and `score_reasoning` as separate columns** (ADR — see
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)).

## Project docs
- [`CLAUDE.md`](CLAUDE.md) — agent home base + the one invariant.
- [`docs/PRD.md`](docs/PRD.md) — what & why.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — pipeline, data flow, module boundaries.
- [`docs/adr/`](docs/adr) — decisions with trade-offs.
- [`docs/devlog/`](docs/devlog) — session-by-session state.
