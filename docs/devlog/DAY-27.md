# DAY 27 — 2026-07-15 (Transferred job apply-type metadata)

## Diagnosis and architecture review

- Compared jobs under all three fixed users. The transferred `vamsi` snapshot had 4,726
  jobs with `easy_apply = NULL`; newer actor output had explicit Easy Apply/External values
  for all Profile 3 jobs and most Profile 2 jobs.
- Current ingestion already maps the cheap scraper's `applyType` field, so newly fetched
  `vamsi` jobs will show the badge. Existing URLs are de-duplicated with
  `ignoreDuplicates`, however, so another fetch would not update historical rows.
- A LinkedIn job URL does not prove Easy Apply versus an external employer portal. The
  repair therefore reads the original run datasets and accepts only explicit actor
  booleans or `EASY_APPLY`/`EXTERNAL` labels; missing history remains unknown.

## Implementation

- Added a dry-run-first, user-scoped recovery tool that locates each historical run using
  only that user's copied Apify keys, downloads the original dataset, matches by the same
  URL-field precedence as ingestion, and updates only NULL `easy_apply` rows.
- The tool never logs tokens, never modifies Apify/source data, skips contradictory
  metadata, and requires `--execute` before changing the isolated database.
- Added regression tests proving LinkedIn URLs alone remain unknown and only explicit
  actor metadata is classified.
- Future ingestion now enriches only the NULL application-type field when a duplicate URL
  reappears with an explicit actor value; scores, workflow state, run ownership, and all
  other job fields remain untouched. The External filter now excludes unknown rows so it
  matches the badge semantics.

## Verification

- Dry-run found explicit metadata for 4,059 jobs across 40 accessible historical runs;
  17 run datasets were no longer accessible. Execution updated exactly those 4,059 NULL
  rows: 697 are now Easy Apply and 3,362 External.
- The remaining 667 unknown rows are 656 scraped jobs whose original datasets are no
  longer accessible and 11 manually added jobs. They remain unlabeled instead of being
  guessed; a future duplicate fetch can enrich the scraped rows when the actor supplies
  the value again. New jobs already receive the current actor's label at ingestion.
- Full quality gates, deployment, and public verification are appended after release.
- Full app regression passed with 203 tests and 9 credentialed evals skipped; backend
  passed 6/6; worker passed 20/20; TypeScript passed; the 33-page production build passed;
  and documentation validation passed with 124 Markdown files and 81 ADRs.
