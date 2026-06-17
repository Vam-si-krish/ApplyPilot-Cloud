# Build: ApplyPilot-Cloud

You are building a **new, cloud-native, self-running job-discovery-and-scoring web app** from scratch in this folder (`ApplyPilot-Cloud`). This document is your complete brief. Read it fully before writing any code.

---

## 0. CRITICAL: Reference the existing project first

There is a working sibling project you MUST study before you start:

```
../ApplyPilot-Lite/
```

It is a Python + React app that already does job discovery + AI scoring locally. **You are NOT modifying it.** You are building a fresh, cloud-deployable rewrite that keeps the *scoring behaviour identical* but replaces local browser-scraping with the Apify API.

**Before writing code, read these files in `../ApplyPilot-Lite/` to understand how scoring works today and replicate it exactly:**

- `src/applypilot/scoring/scorer.py` — **the heart of what you must replicate.** Contains the exact scoring prompt (`SCORE_PROMPT`), the request format, the response parser (`_parse_score_response`), and the scoring loop. Your TypeScript scoring must produce the same scores from the same inputs.
- `src/applypilot/llm.py` — the multi-provider LLM client (Gemini / OpenAI / DeepSeek / Anthropic), including model defaults, retry/back-off on 429/503, and the OpenAI-compatible vs. native-Gemini routing. Replicate the provider abstraction and the retry behaviour.
- `src/applypilot/web/server.py` — the existing FastAPI endpoints and the React UI's API contract (jobs list, profile, resume, settings, stats). Use it as the spec for your API surface and data shape.
- `ui/src/pages/` — the existing React pages (`Dashboard`, `Jobs`, `Profile`, `Settings`, `LinkedInFetch`, `Pipeline`). **Port these designs**; do not redesign from scratch.
- `ui/src/App.tsx`, `ui/tailwind.config.js`, `ui/src/index.css` — the existing styling/theme (dark, slate/sky palette). Match the look and feel.
- `README.md` — overall product description.

> Treat `../ApplyPilot-Lite/` as the source of truth for **scoring logic, the LLM client behaviour, the data model, and the UI design**. When in doubt about how a job should be scored or what a field means, open that project and look.

---

## 1. What this app does (product spec)

A single-user (password-protected) web app, hosted in the cloud, that:

1. **Runs automatically on a daily schedule** (e.g. 06:00 in the user's timezone, configurable in the UI).
2. On each run, **fetches the last 24 hours of job postings** matching the user's saved search criteria (keywords + locations) — using **Apify**, not local scraping.
3. **Scores every fetched job 1–10** for fit against the user's resume, using the **exact scoring prompt and logic from `../ApplyPilot-Lite/src/applypilot/scoring/scorer.py`**.
4. Presents the results on a web page the user visits any time — a shortlist sorted by fit score, with filters.

**It does NOT auto-apply.** There is no application-submission engine. The flow stops at *fetched → scored → shortlisted*. (The original full ApplyPilot had auto-apply; the Lite version and this Cloud version deliberately do not.)

---

## 2. Architecture (the whole point of the rewrite)

The reason this is a fresh build: replacing local Playwright scraping with the **Apify API** removes the only thing that forced the old app to run locally. The app becomes two HTTP calls — fetch (Apify) and score (LLM) — so it can be **fully serverless**.

**Recommended stack:**

| Layer | Choice | Role |
|---|---|---|
| Frontend + API | **Next.js (App Router) on Vercel** | React UI + API routes in one deploy |
| Database + Auth | **Supabase** (Postgres + Auth) | Stores jobs, profile, resume, settings; single-user login |
| Job fetching | **Apify** job-board actor via `apify-client` | Daily proxied scrape of last-24h postings |
| Scoring | LLM API (default **Google Gemini `gemini-2.0-flash`**, same as Lite) | Port of `scorer.py` |
| Scheduling | **Vercel Cron** (or Supabase scheduled function) | Triggers the daily run |

> If a decision is genuinely ambiguous and not answered by `../ApplyPilot-Lite/`, ask the user before guessing. Use TypeScript everywhere unless told otherwise.

### The serverless-timeout pattern (important)

Serverless functions are short-lived (Vercel ~10–60s). Do NOT fetch + score in one request. Decouple:

```
Daily Cron  ──▶  /api/run          → start Apify actor run ASYNC (returns run id), with a webhook
Apify done  ──▶  /api/apify-webhook → write raw jobs into Supabase (status: 'unscored')
            ──▶  /api/score-batch    → score unscored jobs in SMALL batches (loop/queue until none left)
User visits ──▶  reads scored jobs from Supabase
```

- **Apify fetch** is async by design: start the run, get a run id instantly, let Apify call your webhook on completion. Never block a request waiting for a scrape.
- **Scoring** must be chunked so no single function call exceeds the timeout. Score N (e.g. 5–10) jobs per invocation and re-trigger until the unscored queue is empty. Respect LLM rate limits with the same back-off as `llm.py` (Gemini free tier = 15 RPM).

---

## 3. Data model (Supabase Postgres)

Derive field names/semantics from `../ApplyPilot-Lite/src/applypilot/web/server.py` (the `/api/jobs` SELECT lists the columns). At minimum:

**`jobs`**
- `id` (uuid), `url` (unique), `title`, `company`, `location`, `salary`
- `full_description` (text — Apify usually returns this; if missing, fetch detail)
- `application_url`
- `fit_score` (int 0–10, null = unscored), `score_note`, `score_keywords`, `score_reasoning`
- `status` ('unscored' | 'scored' | 'archived'), `is_shortlisted` (bool)
- `discovered_at`, `scored_at`, `source` (e.g. 'apify:linkedin')

**`profile`** — single row of the user's application data. Mirror the shape used by the Lite Profile page (`ui/src/pages/Profile.tsx`): `personal`, `experience`, `compensation`, `work_authorization`, `skills_boundary`, etc. Store the **resume text** here too (scoring reads it).

**`settings`** — schedule time, timezone, search keywords[], locations[], `hours_old` (default 24), results-per-query, chosen LLM provider/model, Apify actor id.

**`runs`** — log of each scheduled run: started_at, finished_at, jobs_found, jobs_scored, errors, apify_run_id.

---

## 4. Scoring — replicate exactly (do not invent your own)

Open `../ApplyPilot-Lite/src/applypilot/scoring/scorer.py` and port it faithfully to TypeScript:

1. **Use the exact `SCORE_PROMPT`** (the "expert Talent Acquisition Strategist" system prompt with PHASE 1 content validation, PHASE 2 alignment analysis, the 0–10 rubric, and the strict `SCORE / KEYWORDS / NOTE / REASONING` output format). Copy it verbatim.
2. **Build the user message the same way** (`score_job`): `RESUME:\n{resume}\n\n---\n\nJOB POSTING:\nTITLE/COMPANY/LOCATION/DESCRIPTION` with the description truncated to **6000 chars**.
3. Call the LLM with **`temperature: 0.2`, `max_tokens: 512`** (same as Lite).
4. **Parse the response identically** to `_parse_score_response`: line-prefixed `SCORE:` / `KEYWORDS:` / `NOTE:` / `REASONING:`, clamp score to 0–10, `0` means "invalid content / not a real job description".
5. Persist `fit_score`, `score_note`, `score_keywords`, `score_reasoning`, `scored_at`.

**LLM client:** port the provider abstraction from `../ApplyPilot-Lite/src/applypilot/llm.py` — support Gemini (default `gemini-2.0-flash`), OpenAI, DeepSeek, Anthropic; pick provider by which API key is set; implement the 429/503 exponential back-off (base 10s, cap 60s, respect `Retry-After`). Most providers are OpenAI-compatible; Gemini and Anthropic need their own request shapes (see the Lite client for both).

---

## 5. Job fetching via Apify

- Use the **`apify-client`** npm package with an `APIFY_TOKEN` (store in env / Supabase settings).
- Pick a multi-board job actor (e.g. a LinkedIn/Indeed/Glassdoor job-board scraper from the Apify Store). Make the **actor id configurable** in settings so it can be swapped.
- Input mapping: user's `keywords` × `locations`, and a **last-24h window** (`hours_old = 24`, or the actor's equivalent "posted in last day" filter). The Lite app exposes the same `hours_old` knob — mirror that.
- Apify job actors usually return **full description + apply URL** in the dataset, so you can likely **skip a separate enrichment step**. Only if `full_description` is missing should you fetch the detail page. (The Lite app has a separate Playwright `enrich` stage; you should not need it.)
- De-dupe by `url` on insert.

---

## 6. Frontend (port from Lite, don't redesign)

Recreate these pages in React/Next.js, matching the existing dark theme and component style in `../ApplyPilot-Lite/ui/`:

- **Dashboard** — stats (total / scored / shortlisted), last run summary, "Run now" button.
- **Jobs** — table sorted by `fit_score` desc, filter by score range / search / status, shortlist toggle, open-in-new-tab apply link, expandable description + reasoning.
- **Profile** — personal info, work auth, skills, resume text + (optional) PDF, search criteria. (Note: the Lite Profile page had bugs the user already fixed — fetch endpoints must tolerate empty/missing data and never `setState` during render; build it clean.)
- **Settings** — schedule time + timezone, LLM provider + API key, Apify token + actor id, search keywords/locations.
- **Auth** — Supabase Auth (email magic-link or a single shared password). The app must not be publicly readable; it exposes the user's resume and personal data.

---

## 7. Deployment

- **Vercel** for the Next.js app. Configure **Vercel Cron** to hit `/api/run` daily at the configured time (cron is UTC — convert from the user's timezone).
- **Supabase** project for Postgres + Auth. Provide the SQL migration for the tables above.
- Document all required env vars in a `.env.example`: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `APIFY_TOKEN`, plus one LLM key (`GEMINI_API_KEY` etc.).
- Write a `README.md` with: setup, env vars, running locally, deploying to Vercel + Supabase, and how scoring mirrors ApplyPilot-Lite.

---

## 8. Build order (deliver an end-to-end slice first)

1. Scaffold Next.js + TypeScript + Tailwind; wire Supabase client; create the SQL migration.
2. **Port the LLM client + scoring** from `../ApplyPilot-Lite/` and unit-test it against a sample resume + job description so scores match the Python version's behaviour.
3. `/api/run` → Apify async start; `/api/apify-webhook` → ingest jobs; `/api/score-batch` → chunked scoring.
4. Jobs + Dashboard pages reading from Supabase.
5. Profile + Settings pages (with persistence).
6. Auth + Vercel Cron + deploy docs.
7. Verify the full daily flow end-to-end (trigger `/api/run` manually, confirm jobs land scored).

Keep each step verifiable. Commit logically. Ask the user when a real decision (host, actor choice, auth style) is genuinely open and not answered by the Lite project.

---

## Summary

Build a **Next.js + Supabase + Apify** clone of the *fetch + score* half of ApplyPilot, that **runs itself daily in the cloud** and is viewable on a hosted, password-protected web page — with **scoring behaviour copied exactly from `../ApplyPilot-Lite/src/applypilot/scoring/scorer.py` and `llm.py`**. No auto-apply. Read the sibling project before you start.
