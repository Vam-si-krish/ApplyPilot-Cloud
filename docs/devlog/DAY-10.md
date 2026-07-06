# DAY 10 — 2026-07-06

## ✅ Company assessment folded into the scoring call + tech stack (ADR 0065)
User insight: scoring already sends the résumé + full description to the LLM, yet a
**separate** company-assessment call re-sent the description as fresh tokens (and only for
high scorers). Merge them — one call — and while there, name the role's tech stack ("is this
a React company?") and flag genuine résumé-harvesters.

Key user guidance that shaped it: an external career-site/ATS account (Workday, Greenhouse…)
is **normal, not a red flag** — many good W2 employers do it. So `low` stays conservative:
only schemes the model actually distrusts (lead-gen / data-farming / shell reposts). Badge
only — no auto-hide, no score penalty. Don't blocklist good companies.

What changed:
- `SCORE_PROMPT` gained a `### COMPANY ASSESSMENT` section *after* the rubric, framed as an
  annotation that MUST NOT move the SCORE. Three appended output lines (`COMPANY_TIER`,
  `COMPANY_NOTE`, `TECH_STACK`); existing lines byte-identical so the parser + eval net are
  untouched. `buildScoreMessages` now also passes `COMPANY SIZE`.
- `parseScoreResponse` parses them defensively (tier→`unknown` default, tech de-duped,
  `none`→null); `scoreJobRows` writes all three in the **same single update**, and duplicate
  postings inherit them. New col `jobs.tech_stack text[]` (migration 0040, applied live).
- Removed the whole old path: `lib/companyCheck.ts`, `/api/assess-batch`, `/api/company-check`,
  `triggerAssessBatch`, Settings `auto_assess_*` (type+route+UI), the Jobs "Assess/re-assess"
  bulk button + delegated poll, and score-progress `mode=assess`. (Dead `auto_assess_*` DB
  columns left in place — harmless, `getSettings` selects `*`.)
- UI: `CompanyTierBadge` now populates on every scored job; tech-stack chips in the Jobs row
  (first 3) + full list in the details pane; JobsLegend documents both.

Verification: typecheck clean (after clearing stale `.next/types` for the two deleted routes);
`vitest run` 154 passed / 6 skipped; **live evals run against DeepSeek — all 6 cases in band**,
confirming the company annotation doesn't perturb scores; `npm run build` clean and the two
routes are gone from the manifest. (`npm run lint` was never configured in this repo — it
prompts to set up ESLint — so it's not a gate; unchanged by this work.)

### Notes / open questions
- No Worker Mac deploy needed for correctness — subscription-mode scoring calls the same
  `scoreJob`; the richer prompt just returns extra lines (max_tokens 1000 has headroom). Worth
  a live subscription-mode spot-check that the worker returns the new lines intact.
- On-demand single-company re-check is gone by design; to refresh a tier, delete the fit score
  and re-score (re-derives the tier + tech too).
- Could later add a Jobs filter to hide `low`-tier rows if harvesters get noisy — deferred;
  user was wary of hiding good companies, so kept it badge-only for now.
- Pre-existing from DAY-9 still open: /api/jobs occasional slow 500s (index/query look).
