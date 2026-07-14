# DAY 17 — 2026-07-14 (Jobs filter correctness)

## Diagnosis

- Pilot 2 had 242 recent jobs, but all 242 had null fit/company/employment/Easy Apply
  fields while awaiting AI scoring. The Jobs page silently defaulted to fit ≥ 6 plus
  company Good/Medium, guaranteeing an empty result.
- Reset reapplied those constraints, the latest run was silently selected, and duplicate
  collapse hid 21 latest-run rows whose canonical belonged to an older run.
- External apply required explicit `false`, although the UI already labels the actor's
  omitted/null flag as External.
- The LinkedIn actor supplied `contractType` and `applyType`, but ingestion dropped both,
  leaving Employment type and Easy Apply empty until AI scoring.

## Implementation

- Made the default and Clear all state truly unconstrained, removed automatic run
  selection, and made every matching filter reset selection/pagination.
- Kept all-runs duplicate grouping, but a selected run now shows every row actually
  fetched by it. External apply includes false or null.
- Normalized actor employment/apply labels during ingestion and backfilled Pilot 2 from
  its three existing private datasets using the credential pinned to each run. This did
  not start another scrape or consume AI quota.
- Recorded the behavior in ADR 0078 and amended ADR 0010's old default-view decision.

## Verification

- The first authenticated production-server probes against Pilot 2 returned all 69 rows
  from the latest run (previously 48), and proved Unscored, Not assessed, External, and
  ATS ≥ 40 no longer collapse to zero because of hidden defaults.
- The metadata backfill matched all 241 recovered unique jobs: 218 Full-time, 17
  Contract, 3 Internship, 3 Other; 45 Easy Apply and 196 External.
- Authenticated probes against the final production build returned 305 unconstrained
  recent canonical jobs; 195 Full-time, 16 Contract, 2 Internship, 3 Other; 43 Easy
  Apply, 262 External (including unknown flags), and 195 Unscored + Full-time.
- App: 180 tests passed (8 credentialed evals skipped), typecheck passed, and the 33-page
  production build passed. Documentation check passed with 105 Markdown files/72 ADRs.
- Backend 2/2 and worker 6/6 regression tests passed; public gateway/database and worker
  health remained green.
