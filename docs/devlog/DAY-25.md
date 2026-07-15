# DAY 25 — 2026-07-15 (Tailoring JSON retry failure)

## Diagnosis and architecture review

- Read-only database inspection confirmed Profile 3's seven applications are now all
  `ready` with a tailored résumé and PDF; the investigation did not modify account data.
- Correlated the UUID-scoped worker calls with the account's private Claude transcripts
  without displaying résumé, job, or cover-letter text. The model calls completed
  successfully, but seven of fourteen observed responses contained raw paragraph breaks
  inside the quoted `cover_letter` JSON value. That exact control-character error made
  `JSON.parse` reject the whole balanced object and explains why rerunning eventually
  worked.
- The defect is at the always-on worker's external model-response boundary. It does not
  involve RLS, account routing, Claude authentication, the Base résumé, or PDF rendering.
  ADR 0086 records the deliberately narrow repair policy.

## Implementation

- Corrected the worker prompt so its example emits escaped `\n` sequences and explicitly
  forbids literal line breaks inside a quoted JSON value.
- Mirrored a deterministic parser fallback in app and worker: parse the untouched object
  first, then escape only raw control characters inside quoted strings and retry parsing
  once. Other malformed JSON is still rejected; normalization and fact-anchored merge
  remain unchanged.
- Added the worker `/version` marker `tailor-json-control-repair`. No migration or
  environment change is required.

## Verification

- Focused app résumé/tailoring tests passed: 45.
- Worker regression suite passed: 20, including a full `tailorResume` call with raw
  cover-letter paragraphs and rejection of unrelated malformed JSON.
- Replayed the parser locally over all fourteen observed Profile 3 tailoring transcripts:
  14/14 are parseable with the fix, without making a model call or exposing their text.
- Full app regression passed with 202 tests and 9 credentialed evals skipped; backend
  isolation/storage tests passed 2/2; TypeScript passed; the 33-page production build
  passed; and documentation validation passed with 121 Markdown files and 80 ADRs.
- Pushed fix commit `3b54cc9`, fast-forwarded the clean server checkout, and restarted
  `com.jobpilotmulti.worker` under a new PID. Local and public gateway health both passed;
  both `/version` endpoints reported `3b54cc9` with `tailor-json-control-repair`.
