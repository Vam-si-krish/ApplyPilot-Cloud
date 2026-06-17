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

## Built (end of Day 1 — full vertical slice complete)
1. ✅ Scaffold + docs; typecheck/build green.
2. ✅ Supabase clients + `0001_init.sql` + `lib/types.ts`.
3. ✅ `lib/llm.ts` + `lib/scoring.ts`; 17 unit tests + evals harness (21 passing, 3 live-skipped).
4. ✅ `/api/run` (GET for cron + POST for UI), `/api/apify-webhook`, `/api/score-batch`.
5. ✅ Dashboard + Jobs + data routes; Profile + Settings + their routes.
6. ✅ Shared-password auth (Web-Crypto session, edge-safe), `middleware.ts`, `/login`,
   login/logout routes, `vercel.json` cron, README with full Supabase+Vercel deploy steps.

Mechanical gates at slice end: `npm run typecheck`, `npm run build` (11 routes,
middleware compiled for edge), `npm test` (21 pass / 3 skip) all green.

## Verified, not yet exercised against live services (next session)
- **Apify actor output schema** is unconfirmed — `mapDatasetItemToJob` reads candidate
  keys defensively but must be checked against a real `bebity~linkedin-jobs-scraper` run.
- **Live scoring eval** not run here (no key in env). Run `npm test` with `GEMINI_API_KEY`
  set to confirm score bands, ideally cross-checking a few jobs against ApplyPilot-Lite.
- **End-to-end** (`/api/run` → webhook → scored rows) needs a real Supabase + Apify + LLM
  to validate the self-retrigger loop and run finalization.
- **Résumé PDF upload** intentionally omitted (optional in the brief); only `resume_text`
  (what scoring reads) is wired. Add via Supabase Storage if wanted.

## Next
1. Provision Supabase (run the migration) + set env; smoke-test login + Profile/Settings save.
2. Trigger `/api/run` manually; confirm jobs land `unscored` then `scored`; adjust the Apify
   mapping to the real schema.
3. Run the live evals with a key; add any misjudged real jobs as new eval cases.
