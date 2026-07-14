# ADR 0078 — Jobs filters are explicit and null-aware

**Status:** accepted · **Date:** 2026-07-14 · **Amends:** the default-view portion of
ADR 0010 · **Relates to:** ADRs 0053 and 0057

## Context

Pilot 2 had 242 recent jobs, including 241 newly recovered unscored jobs. The Jobs page
returned zero by default because it silently combined `fit_score >= 6` with company tier
`good,medium`; every new row correctly had null AI fields until scoring. The Reset button
restored those constraints instead of clearing them.

The page also silently selected the latest run. Run filtering happened after duplicate
rows were collapsed under canonical rows, so 21 latest-run rows disappeared because
their canonical belonged to an earlier run. Finally, the UI displayed a missing
`easy_apply` value as an external application while the API's External filter accepted
only explicit `false`, excluding all null actor results.

## Decision

- Jobs opens with no score, company, run, apply-type, or hide-rule constraint.
- “Clear all” removes every user-visible constraint; recommended fit/company filters are
  opt-in.
- Run selection is explicit. When a run is selected, show every row fetched in that run
  rather than applying the cross-run duplicate collapse.
- External applications mean `easy_apply = false OR easy_apply IS NULL`, matching how the
  row is labeled in the UI.
- Every match-changing filter clears bulk selection and resets pagination.

## Consequences

- Fresh/unscored jobs are immediately visible and each filter behaves independently.
- An all-runs view remains deduplicated and grouped; a specific run can intentionally
  contain repeated/multi-location rows so its displayed count matches that fetch.
- Null AI-derived employment/company/fit fields still do not satisfy a user-selected AI
  filter. The difference is that those filters are no longer silently active.

## Verification

Use Pilot 2's restored rows to prove: unconstrained recent view is non-empty, unscored
works without clearing other defaults, latest-run count matches `jobs_found`, External
includes null actor flags, ATS/company-not-assessed filters match database counts, and
Clear all returns to the unconstrained view.
