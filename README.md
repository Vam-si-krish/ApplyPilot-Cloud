# ApplyPilot-Cloud

> **`multi-user-fork` branch:** this branch is becoming a separate multi-user product
> with its own server-laptop backend and no runtime access to ApplyPilot production data.
> Phase 2A now supports three fixed private accounts with enforced per-user ownership and
> résumé onboarding. A one-time owner-authorized snapshot populated the isolated `vamsi`
> account; it is not a shared database or ongoing sync. Public self-service signup remains
> deferred. See [ADR 0073](docs/adr/0073-fixed-accounts-and-enforced-user-ownership.md)
> and the [backend runbook](backend/README.md).

A private multi-user web app that **runs itself daily in the cloud**:
it fetches the last 24 hours of job postings (via Apify), scores each **1–10** for
fit against your resume (via an LLM), and shows a ranked, filterable shortlist.
Tailor & Apply includes an AI navigation queue for every unapplied job with a usable
link. An installed extension fills first; a user-invoked Chrome agent completes missed
fields from saved candidate facts, clicks Next and Submit, verifies visible success, and
leaves unknown-answer tabs in Needs review while continuing (ADRs 0093–0095).

It began as a cloud-native rewrite of the *fetch + score* half of `ApplyPilot-Lite`,
replacing local Playwright scraping with the Apify API. Its scoring contract has since
evolved into the weighted v2 rubric documented in
[Current scoring](#current-scoring) and ADR 0022.

## Stack
- **Next.js 14 (App Router)** on Netlify — React UI + API routes in one deploy
- **PostgreSQL on the server laptop** — jobs, profile, settings, runs
- **Apify** — daily job fetch (configurable actor, default `cheap_scraper~linkedin-job-scraper`)
- **LLM scoring** — Gemini `gemini-2.0-flash` by default (OpenAI / DeepSeek / Anthropic supported)
- **Netlify scheduled functions** — trigger the daily run
- Auth: three fixed usernames/passwords → signed identity session cookie

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
  [Apify](https://apify.com) account + token, and either a supported LLM API key or a
  Claude/ChatGPT subscription available to connect.

## Local development

`multi-user-fork` is production. Feature integration happens on `develop` in a separate
local worktree backed by the isolated `/jobpilot-dev` stack (ADR 0089). Use
`scripts/jobpilot-dev-server` there; merge verified work into `multi-user-fork` and use
`scripts/jobpilot-server` only for production.

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
   - `APP_USERS_JSON` (three fixed accounts) and `AUTH_SECRET` (`openssl rand -hex 32`)
   - `CRON_SECRET` (`openssl rand -hex 32`)
   - `NEXT_PUBLIC_APP_URL=http://localhost:3000`
3. **Run it:**
   ```bash
   npm run dev          # http://localhost:3000 → log in with a configured account
   ```
4. Upload a résumé PDF in onboarding, then add that account's Apify and LLM keys in
   **Settings**. Hit **Run now** on the Dashboard to kick a run.

### Develop from the personal laptop

The server laptop is designed to stay on and unattended. From a fresh personal-laptop
clone of `multi-user-fork`, run:

```bash
./scripts/jobpilot-server setup-key   # one-time; enter the server Mac password once
./scripts/jobpilot-server bootstrap   # protected .env.local + npm ci + connectivity checks
npm run dev                           # local UI/API against the isolated server backend
```

The setup key is restricted to the allowlisted operator commands and cannot open a shell
or forward ports. Normal deployment is `git commit` followed by
`./scripts/jobpilot-server deploy`; it pushes the branch, triggers the server update
immediately, waits for the deployed commit, and relies on Netlify's branch deploy for the
frontend. See the [personal-laptop runbook](backend/README.md#personal-laptop-development-and-operations).

### Where each user updates AI context

- **Candidate Profile → Résumé** is the source of truth for experience, titles, dates,
  education, projects, skills, and contact details.
- **Candidate Profile → Eligibility** stores authorization, sponsorship need, permit type,
  citizenship/residency, clearance, and job-avoidance choices. Blank eligibility facts mean unknown.
- **Candidate Profile → Application Answers** stores reusable truthful answers for
  ApplyBuddy. **AI Guidance** customizes scoring and tailoring emphasis without replacing
  the reviewed truthfulness, eligibility, score-format, or résumé-length rules.
- **Settings → Search criteria** controls which roles, locations, and scraper skill terms
  are fetched. It does not rewrite résumé facts.

Onboarding initializes these from the uploaded PDF where possible. Existing job scores and
generated files are not automatically rewritten after an edit; delete/re-run a score or
regenerate the application document when you want the new context applied.

To use a Claude subscription instead of an Anthropic API key, open **Settings →
AI & Models → Claude connection**, authenticate on Anthropic's website, paste the one-time
authorization code, and select **Claude subscription (no API key)** for Tailoring.
ApplyPilot never receives the user's Claude password or browser cookies. A successful
connection automatically selects the subscription lane for tailoring.

To use a ChatGPT subscription without an OpenAI API key, open **Settings → AI & Models →
ChatGPT connection**, start the login, and enter the displayed one-time code on OpenAI's official
device page. ApplyPilot stores the completed Codex login only under that account's UUID;
it never receives the ChatGPT password. A successful connection selects ChatGPT for tailoring.

Settings is organized by goal: **Job Search**, **Automation**, **AI & Models**,
**Connections & Keys**, and **Advanced**. On phones, use the category selector at the top.
Candidate résumé facts, application answers, and scoring/tailoring guidance remain under
Candidate Profile rather than being duplicated in Settings.

### Commands
```bash
npm run dev          # dev server
npm run build        # production build
npm run typecheck    # tsc --noEmit
npm run test         # vitest: scoring parser, provider detection, evals
npm run docs:check   # required docs + local links + ADR numbering
```

The current Next.js 14 setup has no working lint command; typecheck, tests, build, and
`docs:check` are the required gates until linting is configured.

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
   self-retriggering batches resolve to this deployment. Do not leave the documented
   `your-new-site.netlify.app` placeholder; the app now rejects placeholder/local
   callback targets before starting a billable actor.
5. Keep the deployment limited to the three configured accounts. Public account creation
   remains blocked until signup, password reset, and abuse controls are implemented.

Scheduling uses the committed Netlify functions in `netlify/functions/`. `CRON_SECRET`
authenticates their calls into the app.

## Current scoring

The current scorer in [`lib/scoring.ts`](lib/scoring.ts) uses a recruiter-style weighted
rubric: must-have skills 60%, role relevance 25%, and experience/seniority 15%, with
candidate-specific blockers and a cap when a core hard requirement is genuinely missing.
The shared prompt contains no owner's résumé/status: it receives the authenticated user's
Base résumé and explicitly maintained Work Auth context at call time (ADR 0080). It sends
up to 15,000 characters of cleaned job description, uses one model call per job at
temperature 0.1 and a 1,000-token response limit, and returns company assessment in that
same response. Provider or parse failure is stored visibly as score 0.

The eval cases protect expected score bands and known regressions. Exact parity with the
original Lite Python scorer was retired by ADR 0022.

The LLM client ([`lib/llm.ts`](lib/llm.ts)) ports `llm.py`: provider auto-detection by env key
(Gemini default), the OpenAI-compatible call path with the Gemini compat→native fallback, the
Anthropic Messages shape, and 429/503 + timeout retry with exponential back-off.

## Project docs
- [`AGENTS.md`](AGENTS.md) — mandatory architecture/documentation rules for every change.
- [`CLAUDE.md`](CLAUDE.md) — agent home base + the one invariant.
- [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) — development lifecycle and definition of done.
- [`docs/PRD.md`](docs/PRD.md) — what & why.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — pipeline, data flow, module boundaries.
- [`docs/adr/`](docs/adr) — decisions with trade-offs.
- [`docs/devlog/`](docs/devlog) — session-by-session state.
