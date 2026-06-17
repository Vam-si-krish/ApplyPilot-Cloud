# Devlog — Day 1 (2026-06-17)

## Ran
- Read the brief (`prompt.md`) and studied the reference project `../ApplyPilot-Lite/`:
  `scoring/scorer.py` (SCORE_PROMPT, parser, score_job), `llm.py` (multi-provider client +
  429/503 back-off + Gemini-native fallback), `web/server.py` (the `/api/jobs` column
  contract + settings shapes), and the UI theme (`tailwind.config.js`, `index.css`, `App.tsx`).
- Confirmed open decisions with the user:
  - Session scope = **code + migrations + docs** (no live provisioning).
  - Auth = **single shared password** (ADR 0003).
  - Apify default actor = **LinkedIn scraper, configurable** (ADR 0005).
- Scaffolded the project: `package.json`, `tsconfig.json`, Next/Tailwind/PostCSS/Vitest
  config, `app/layout.tsx` + `app/globals.css` (theme ported from Lite), `.env.example`, `.gitignore`.
- Wrote tracking docs: `CLAUDE.md`, `docs/PRD.md`, `docs/ARCHITECTURE.md`, `docs/AI_WORKFLOW.md`,
  ADRs 0001–0005, this devlog.

## Found (and fixed)
- Lite stores `score_reasoning` as `"{keywords}\n{reasoning}"` combined and has no
  `score_keywords` column. The brief's data model wants them **separate** → Cloud keeps
  four distinct columns; the parser already returns all four fields. Noted in ARCHITECTURE.
- Lite's job dict uses `site` for company and `full_description`/`description`; the Cloud
  schema standardises on `company` + `full_description`. The scorer port maps accordingly.

## Observed, not changed
- `bebity~linkedin-jobs-scraper` exact output field names are unconfirmed — mapping must be
  written defensively and checked against a real run.
- Vercel timeout figures should be re-confirmed at deploy time.

## Next
1. `npm install`; verify typecheck/build on the empty shell.
2. Supabase client + SQL migration (jobs/profile/settings/runs) + `lib/types.ts`.
3. Port `lib/llm.ts` + `lib/scoring.ts` with unit tests + seed `evals/cases/`.
4. API routes `/api/run`, `/api/apify-webhook`, `/api/score-batch`.
5. Jobs + Dashboard, then Profile + Settings.
6. Auth middleware + Vercel cron + README/deploy docs.
