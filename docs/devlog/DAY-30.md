# DAY 30 — 2026-07-15 (Tailor & Apply filtering and ATS comparison)

## Requested behavior

- Show whether every Tailor & Apply job is Easy Apply or External Apply.
- Filter the Queue and Set Aside workspaces by those application types.
- After generating a tailored résumé, keep the original Base ATS score visible beside the
  new tailored ATS score, including unchanged before/after results.

## Decision and implementation

- Recorded ADR 0090. The Tailor & Apply slim job projection now carries `easy_apply`, and
  the client uses the same null-aware External semantics as Jobs.
- Added an application-type filter and persistent row badge without adding another query
  or changing the per-user/RLS ownership boundary.
- Made the ATS route require a computable Base score before persisting either side of the
  comparison. The row now renders `base% → tailored%` even when both scores are equal;
  legacy tailored-only rows are labeled as Base unavailable until rechecked.

## Verification

- Focused regressions prove null source flags remain External, equal scores render as a
  complete pair, the ATS route refuses a missing Base result, and an equal Base/tailored
  result persists both fields.
- The complete app suite passed 207 tests with 9 credentialed evals skipped; backend
  passed 13/13 and the résumé worker passed 20/20. TypeScript passed.
- The 33-page production build passed, and documentation validation passed with 131
  Markdown files and 84 ADRs.
- The isolated development server deployed commit `7198716`; gateway, worker, and the
  application→job `easy_apply` projection passed publicly. Netlify rejected that commit
  only because its `develop` context still lacks the documented Builds-scoped
  `SECRETS_SCAN_OMIT_KEYS=DEPLOYMENT_ENV`; hosted UI verification remains pending.
