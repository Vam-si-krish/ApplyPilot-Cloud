# ADR 0090: Tailor & Apply application type and complete ATS comparison

- Status: accepted
- Date: 2026-07-15
- Amends: ADRs 0053 and 0078

## Context

Tailor & Apply receives jobs that already own deterministic `easy_apply` metadata, but its
slim list projection omitted that field. The workspace could therefore neither label nor
filter Easy Apply versus external applications even though Jobs already supported both.

The tailored-résumé ATS check computes the Base and tailored résumé against the same job
in one request. Its row chip nevertheless hid the Base value whenever both scores were
equal, and the route swallowed a Base-résumé read failure and persisted a tailored-only
result. Both behaviors made a completed comparison look like a single new score.

## Decision

- Include `jobs.easy_apply` in the Tailor & Apply slim projection. Display an application-
  type badge on every surviving job row and provide an All / Easy Apply / External Apply
  filter in both Queue and Set Aside.
- Preserve ADR 0078 semantics: explicit `true` is Easy Apply; `false` or missing source
  metadata is External Apply. An application whose job was deleted does not match either
  apply-type filter.
- A successful tailored ATS check is atomic as a comparison. It must compute and persist
  both `base_match_score` and `tailored_match_score` with the same single-job algorithm.
  Missing Base résumé text or a Base scoring failure returns a visible error rather than
  silently storing a tailored-only score.
- Render `base% → tailored%` whenever a tailored score exists, including when both values
  are equal. A legacy tailored-only row is labeled `Base unavailable → tailored%` until
  the user rechecks it.

## Consequences

- Application-type filtering is deterministic, local to the already user-owned job join,
  and introduces no new database or trust boundary.
- The ATS comparison remains local and free; it does not reinstate the removed LLM
  tailored-résumé re-score or mutate the job's AI `fit_score`.
- Existing tailored-only rows are not fabricated or backfilled. Rechecking repairs them
  from the current Base and tailored résumés using the same scoring call.

## Verification

- Regression-test Easy/External/null filter semantics and equal-score comparison text.
- Confirm the slim application query includes `easy_apply` and the UI exposes the badge
  and filter.
- Confirm the ATS route refuses an absent Base score and a completed row always displays
  both values.
