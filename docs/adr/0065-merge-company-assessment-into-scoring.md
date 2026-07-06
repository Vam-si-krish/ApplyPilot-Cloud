# 0065 — Fold company assessment into the single scoring call + tech stack

## Context

Each job cost **two** LLM calls. The fit scorer (`SCORE_PROMPT`, `scoreJob`) already receives
the résumé (cached, ADR 0056) and the full HTML-stripped description. A *separate* company
assessment (ADR 0009/0010: `assessCompany`, `COMPANY_PROMPT`) then ran a second call that
**re-sent the description as fresh, uncached tokens** and only fired for jobs above
`auto_assess_min_score`. So the employer verdict was both redundant (the scorer had all the
same inputs) and partial (top scorers only).

The user also wanted to *see* the role's core tech at a glance ("is this a React company?"),
and — critically — clarified how conservative the employer red-flag should be: a legitimate
employer that makes you create an account on its own external ATS / career site (Workday,
Greenhouse, iCIMS…) is **completely normal and must not be flagged**. Only genuine
résumé-harvesting / lead-gen / data-farming schemes the model actually has reason to distrust
belong in tier `low`. "Don't blocklist good companies."

## Decision

**Merge the company assessment into the scoring call — one LLM call per job still.**

- `SCORE_PROMPT` gains a `### COMPANY ASSESSMENT` section *after* the scoring rubric, framed as
  an **independent annotation that MUST NOT change the SCORE / sub-scores / seniority**. It ports
  the conservative `COMPANY_PROMPT` semantics (good/medium/low/unknown; don't-guess → `unknown`;
  never demote for contract/staffing) and adds the explicit caveat that an external career-site
  account is not a red flag by itself — `low` is reserved for schemes whose *purpose* is to farm
  data / upsell / drive third-party signups.
- Three new output lines, appended so every existing line stays byte-identical (parser order
  unchanged, defensive): `COMPANY_TIER`, `COMPANY_NOTE`, `TECH_STACK`. `parseScoreResponse`
  clamps the tier to the four valid values (default `unknown`) and splits/de-dupes the tech list
  (`"none"` ⇒ null). A parse/LLM failure still yields visible `score 0` + null company fields —
  never fabricated. `buildScoreMessages` also now includes `COMPANY SIZE` (the résumé cache
  breakpoint is untouched).
- `scoreJobRows` writes `company_tier` / `company_tier_note` / `tech_stack` in the **same single
  `update`**; duplicate postings (ADR 0057) inherit them from their canonical. New column
  `jobs.tech_stack text[]` (migration 0040); `company_tier*` already exist (0007).

**Remove the old company-assessment path entirely.** Deleted `lib/companyCheck.ts`,
`/api/assess-batch`, `/api/company-check`, `triggerAssessBatch`, the Settings
`auto_assess_enabled` / `auto_assess_min_score` (type + route + UI), the Jobs "Assess / re-assess"
bulk button + its delegated-poll, and the `mode=assess` branch of `/api/score-progress`. The two
DB columns `auto_assess_*` are left in place (dead but harmless — `getSettings` selects `*` and
casts) and can be dropped later.

**UI:** the existing `CompanyTierBadge` now lights up on *every* scored job; tech-stack chips show
in the Jobs row (first 3) and the full list in the details pane; `JobsLegend` documents both.

## Consequences

- One round-trip and one write per job instead of two; the employer verdict rides the
  cached-résumé call as a few extra output tokens instead of a second full-description send.
  Company intel now covers **every LLM-scored job**, not just high scorers.
- Scoring invariant held: the six live eval cases (`evals/cases/`, run against DeepSeek) all stayed
  in band with the company section present — the annotation does not move scores.
- Red flags stay **badge-only** — no auto-hide, no score penalty (matches the flag-not-demote
  philosophy of the Contract badge). `low` is deliberately conservative per the user's guidance.
- No Worker Mac deploy needed for correctness: subscription-mode scoring calls the same
  `scoreJob`; the richer prompt just returns more lines. (`max_tokens` 1000 already has headroom.)
- Re-checking a single company on demand is gone; to refresh a tier, delete the fit score and
  re-score the job (which now re-derives the tier too).
