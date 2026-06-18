# ADR 0010 — Daily pipeline: auto-assess companies for high scorers + recommended default view
**Status:** accepted · **Date:** 2026-06-18 · **Extends:** ADR 0004 (pipeline), ADR 0009 (company assessment)
## Context
ADR 0009 made AI company assessment strictly on-demand. The user now wants the **daily run** to do
it automatically, but only for jobs worth applying to: fetch → score → for jobs scoring ≥ N, assess
the company → surface the result. And the Jobs page should default to the cream: score ≥ 6 at
good/medium companies. (Cost is no longer a concern; scheduling already exists via `vercel.json`.)
## Decision — a 3rd pipeline stage
Add `POST /api/assess-batch` (CRON_SECRET auth; added to middleware `SELF_AUTH_PATHS`), analogous to
`/api/score-batch`: it pulls scored jobs with `fit_score >= auto_assess_min_score` and
`company_tier IS NULL`, assesses ≤ `ASSESS_BATCH_SIZE` per call via `assessCompany`
(`lib/companyCheck.ts`, the separate non-fit prompt), and re-triggers itself until none remain. When
`/api/score-batch` drains the unscored queue (either done path) and `settings.auto_assess_enabled`,
it fires `triggerAssessBatch()`. So the canonical flow becomes:

`Cron → /api/run → webhook (ingest) → score-batch loop → assess-batch loop → done.`

Two settings (migration 0008): `auto_assess_enabled` (default **true**) and `auto_assess_min_score`
(default **6**). The fit-scoring call/prompt/parser are untouched (CLAUDE.md invariant); assessment
remains a separate call. Run status still finalizes at scoring completion — assessment is a tail
stage that only writes `company_tier`/`company_tier_note`.
## Decision — recommended default view
The Jobs page defaults `minScore=6` and `companyTier=good,medium` (new "Good or Medium" filter option;
`/api/jobs` accepts comma-separated `companyTier` via `.in()`). Users widen via the filters. The
on-demand "Assess companies (selected)" button (ADR 0009) is unchanged for ad-hoc re-assessment.
## Trade-offs / notes
- The default view **hides** jobs with `company_tier` `low`, `unknown`, or **null** (not yet
  assessed). Since `unknown` is common for small employers, some legitimate jobs are hidden by
  default — intentional per the user ("medium and high"); switch the company filter to "Any" to see
  them. Null-tier 6+ jobs appear once the assess stage finishes (seconds–minutes after scoring).
- No infinite loop: assess-batch never re-triggers score-batch; it only re-triggers itself.
- Schedule time is still set in `vercel.json` (Vercel cron is static); the Settings time is advisory.
