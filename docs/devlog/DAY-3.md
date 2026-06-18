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

## Built — Gmail two-phase sync + live progress (ADR 0013)
Bug: the single-pass sync classified ≤15/run then advanced `last_synced_at` to now — backlog beyond
the cap was stranded forever. Fix splits sync into **fetch → classify**:
- Migration 0011: `mail_messages.category` nullable + `status('pending'|'classified')`. Fetch stores
  raw messages as `pending`; classify flips them to `classified`. Existing rows backfilled.
- `lib/mailSync.ts`: `fetchChunk` paginates the **whole** window (`listAllMessageIds`, cap 500),
  de-dupes by `gmail_id`, stores 25/run as pending, and advances `last_synced_at` **only when no
  fresh ids remain** → nothing skipped. `classifyChunk` labels 8/run (separate LLM call, SCORE_PROMPT
  untouched).
- Routes: `POST/GET /api/gmail/fetch` + `/api/gmail/classify-batch` (one chunk each, return progress;
  in middleware SELF_AUTH). `/api/gmail/sync` rewritten as a **headless cron orchestrator** (loops
  both phases under a ~50s budget; next tick resumes). `GET /api/mail` returns a `pending` count.
- UI: "Sync now" **drives the loop client-side** — fetch until done ("N found", mail appears as
  **Pending** immediately), then classify-batch until drained, with a live progress bar
  ("X of N classified") + final "Done". Pending count also shown in the header subtitle.

### Applied to live DB
- `0011_mail_pending.sql` — applied + verified. One-off: `update gmail_connection set
  last_synced_at = null` so the next fetch backfills the full last-3-days the buggy cursor skipped.

## Next
1. Real daily run end-to-end: confirm score → auto-assess → recommended view populates; sanity-check
   tiers and the `unknown` discipline.
2. Open the Inbox and hit "Sync now": confirm the 3-day backlog all appears as Pending, then drains to
   classified with live progress.
3. Commit to `main`.
