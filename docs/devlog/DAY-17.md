# DAY 17 — 2026-07-14 (Jobs filter correctness)

## Diagnosis

- Pilot 2 had 242 recent jobs, but all 242 had null fit/company/employment/Easy Apply
  fields while awaiting AI scoring. The Jobs page silently defaulted to fit ≥ 6 plus
  company Good/Medium, guaranteeing an empty result.
- Reset reapplied those constraints, the latest run was silently selected, and duplicate
  collapse hid 21 latest-run rows whose canonical belonged to an older run.
- External apply required explicit `false`, although the UI already labels the actor's
  omitted/null flag as External.

## Implementation

- Made the default and Clear all state truly unconstrained, removed automatic run
  selection, and made every matching filter reset selection/pagination.
- Kept all-runs duplicate grouping, but a selected run now shows every row actually
  fetched by it. External apply includes false or null.
- Recorded the behavior in ADR 0078 and amended ADR 0010's old default-view decision.

## Verification

- Authenticated production-server probes against Pilot 2 now return: 216 unconstrained
  recent jobs, 216 Unscored, all 69 rows from the latest run (previously 48), 216
  External/null-flag rows (previously 0), 216 Not assessed, and 58 ATS ≥ 40.
- App: 178 tests passed (8 credentialed evals skipped), typecheck passed, and the 33-page
  production build passed. Documentation check passed with 105 Markdown files/72 ADRs.
- Backend 2/2 and worker 6/6 regression tests passed; public gateway/database and worker
  health remained green.
