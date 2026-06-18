# Devlog — Day 3 (2026-06-18)

## Context
Continued from Day 2 (key vault, auto-rotate, pre-filter, manual re-score, job selection — all on
`main`). Day 3 adds workflow features around actually applying to jobs.

## Built
1. **"Opened" row tracking** (ADR 0009) — `jobs.clicked_at` (migration 0007). Opening a job's apply
   link PATCHes `clicked_at` (optimistic); rows with `clicked_at && !applied_at` get a violet tint +
   "Opened" badge and an **opened** filter, so the user sees where they stopped after ctrl-clicking
   many tabs. The existing "Did you apply?" popup stays.
2. **Bulk Mark applied** — selection-toolbar button PATCHes `applied_at` for all selected.
3. **AI company assessment** (ADR 0009) — `lib/companyCheck.ts`: a **separate** LLM call (own
   `COMPANY_PROMPT`, does NOT touch the frozen `SCORE_PROMPT`) rating the employer
   good/medium/low/unknown + note, told to answer `unknown` rather than guess. Run **on demand only**
   via "Assess companies (selected)" → `POST /api/company-check` (session-gated, chunked). Stored in
   `company_tier`/`company_tier_note`; shown as a row badge + company-tier filter + expanded note.
   `company_size` captured defensively in `mapDatasetItemToJob` (often null) and displayed.

## Decisions
- User rejected a heuristic spam score (the local prefilter felt inaccurate) and has **no cost
  concerns** → company detection is AI. Saved as a memory ([no-cost-concerns-prefer-ai]).
- On-demand (not auto) is a **relevance** choice: only assess companies behind high scorers the user
  would actually apply to — not a cost decision.

## Migrations applied to live DB this session
- `0007_opened_and_company.sql` — `clicked_at`, `company_size`, `company_tier`(+check),
  `company_tier_note`; verified.

## Not yet exercised live
- `assessCompany` quality depends on the model (DeepSeek) recognizing the company; needs a real run
  to confirm tiers are sensible and `unknown` is used (not fabricated) for obscure employers.
- `company_size` capture is unconfirmed against real actor output (likely null for most).

## Built — automated assess stage + recommended view (ADR 0010)
- New 3rd pipeline stage `POST /api/assess-batch` (CRON auth, in middleware SELF_AUTH): after
  `/api/score-batch` drains, if `settings.auto_assess_enabled`, it auto-assesses companies for jobs
  scoring ≥ `auto_assess_min_score` (default 6) that have `company_tier IS NULL`, chunked +
  self-retriggering. Flow: `run → webhook → score-batch loop → assess-batch loop`. Migration 0008
  adds the two settings; Settings page gets a "Company Assessment" section.
- Jobs page now defaults to the **recommended** view: `minScore=6` + `companyTier=good,medium` (new
  "Good or Medium" option; `/api/jobs` supports comma-separated `companyTier`). Hides low/unknown/null
  by default — switch the company filter to "Any" to widen.
- Also this session: recency split (main = last 24h) + new **Past Jobs** page (`/past`, date-grouped),
  runs-dropdown closes on outside-click/Esc, shared `<JobDetails>` component.

## Applied to live DB
- `0008_auto_assess.sql` — `auto_assess_enabled` (true), `auto_assess_min_score` (6); verified.

## Next
1. Real daily run end-to-end: confirm score → auto-assess → recommended view populates; sanity-check
   tiers and the `unknown` discipline.
2. Commit to `main`.
