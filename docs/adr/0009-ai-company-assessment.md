# ADR 0009 — AI company assessment (on-demand), "opened" tracking, bulk actions
**Status:** accepted · **Date:** 2026-06-18 · **Relates to:** ADR 0008 (scoring pipeline)
## Context
Many postings are time-wasters: staffing-mill reposts, lead-gen, resume-upsell, data-harvesting
listings. The user wanted a way to flag bad employers and confirm reputable ones. They explicitly
rejected a hand-written heuristic (the local prefilter/ATS score didn't track real quality well) and
have no token-cost concerns — so detection is done by the LLM. They also wanted to see which jobs
they've already opened (ctrl-clicking many at once) and to mark several applied at once.
## Decision — AI company tier, separate and on-demand
`lib/companyCheck.ts` adds a **dedicated** prompt (`COMPANY_PROMPT`, NOT scoring.ts) that rates the
employer `good | medium | low | unknown` with a one-line note, using the model's own knowledge plus
scraped facts (company name, `company_size`, location, snippet). It is told to answer **`unknown`**
rather than guess for unrecognized companies (anti-hallucination); parse/LLM failure → `unknown`,
never fabricated. This is a **separate LLM call** from fit-scoring, so the frozen `SCORE_PROMPT` /
parser invariant (CLAUDE.md) is untouched.

Triggered **only on demand** via the "Assess companies (selected)" bulk button →
`POST /api/company-check` (session-gated, chunked, reuses `buildScoringClient`). Not run in the
scoring loop and not on a schedule. This is a **relevance** choice, not a cost one: there's no point
assessing the employer behind a job that scored poorly — the user filters to high scorers, hand-picks
a few, and assesses those. Result stored in `jobs.company_tier` / `company_tier_note` (migration
0007), surfaced as a row badge + a company-tier filter.

`company_size` is captured defensively in `mapDatasetItemToJob` (candidate keys, string-or-number)
and displayed when present — but job-search scrapes often omit headcount, so it's frequently null.
## Decision — "opened" tracking + bulk actions
`jobs.clicked_at` (migration 0007) is set when the user opens a job's apply link; rows with
`clicked_at && !applied_at` show a violet tint + "Opened" badge and an "opened" filter, so the user
can see where they stopped after opening many tabs. Bulk **"Mark applied"** and **"Assess companies"**
join the existing selection toolbar (Score/Archive/Delete).
## Alternatives considered
- **Heuristic red-flag score** — rejected by the user as inaccurate.
- **Fold company check into fit scoring** — rejected: would change the frozen SCORE_PROMPT.
- **Auto-assess every scored job** — rejected: irrelevant for low scorers; on-demand fits the workflow.
## Notes
LLMs reliably recognize only well-known companies, so `low`/`unknown` is common for small employers;
the tier is a signal, not a verdict. The pay-for-resume popup happens post-application and isn't in
the scraped text, so it can't be detected pre-apply.
