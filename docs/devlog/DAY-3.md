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

## Next
1. Real run: open a few links (confirm "Opened" persists), bulk mark-applied, then select high
   scorers and "Assess companies" — sanity-check the tiers and the `unknown` discipline.
2. Commit to `main`.
