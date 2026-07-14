# ApplyPilot-Cloud

> **`multi-user-fork` branch:** this branch is becoming a separate multi-user product
> with its own server-laptop backend and no access to ApplyPilot production data.
> Phase 1 builds and verifies the isolated single-user baseline; Phase 2 adds account
> creation and per-user data/API-key isolation. See [ADR 0072](docs/adr/0072-independent-multi-user-fork-foundation.md)
> and the [backend runbook](backend/README.md).

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
- **Next.js 14 (App Router)** on Netlify — React UI + API routes in one deploy
- **PostgreSQL on the server laptop** — jobs, profile, settings, runs
- **Apify** — daily job fetch (configurable actor, default `bebity~linkedin-jobs-scraper`)
- **LLM scoring** — Gemini `gemini-2.0-flash` by default (OpenAI / DeepSeek / Anthropic supported)
- **Netlify scheduled functions** — trigger the daily run
- Auth: a single shared password → signed session cookie

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full pipeline and
[`docs/adr/`](docs/adr) for the decisions behind it.

## How it works (the pipeline)
```
Netlify schedule (daily)  ─▶ GET /api/run          start Apify actor ASYNC + webhook
Apify finishes scrape    ─▶ POST /api/apify-webhook ingest jobs → status 'unscored'
                         ─▶ POST /api/score-batch   score N jobs/call, re-trigger until drained
You open /jobs           ─▶ read scored jobs, sorted by fit score
```
Fetch and score are decoupled so no single serverless invocation exceeds the
function timeout (ADR 0004).

## Prerequisites
- Node 20+, the server-laptop backend from [`backend/`](backend/README.md), an
  [Apify](https://apify.com) account + token, and one supported LLM API key.

## Local development
```bash
npm install
cp .env.example .env.local      # then fill in the values (see below)
```

1. **Install the isolated backend.** Follow [`backend/README.md`](backend/README.md).
   Its migration runner applies every file in `supabase/migrations/` to the fork's
   separate PostgreSQL database; the directory name is retained for schema history.
2. **Fill `.env.local`** (all keys documented in [`.env.example`](.env.example)):
   - `BACKEND_URL`, `BACKEND_SERVICE_KEY`
   - `RESUME_WORKER_URL`, `RESUME_WORKER_SECRET`
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

## Deploying `multi-user-fork`

1. Install and verify the server backend using [`backend/README.md`](backend/README.md).
2. Import this repository into a **new Netlify site** and select `multi-user-fork` as
   the production branch.
3. Set only the new environment values listed in the backend runbook. Never copy the
   production ApplyPilot backend values.
4. Set `NEXT_PUBLIC_APP_URL` to the new Netlify/custom-domain URL so webhooks and
   self-retriggering batches resolve to this deployment.
5. Keep the deployment owner-only under the Phase 1 password. Public account creation
   is blocked until ADR 0072 Phase 2 is implemented and verified.

Scheduling uses the committed Netlify functions in `netlify/functions/`. `CRON_SECRET`
authenticates their calls into the app.

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
