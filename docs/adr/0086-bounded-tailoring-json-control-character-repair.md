# ADR 0086: Bounded repair for tailoring JSON control characters

- Status: accepted
- Date: 2026-07-15
- Builds on: ADRs 0027, 0051, 0060, 0074, and 0085

## Context

Profile 3 generated seven tailored résumés through its UUID-isolated Claude
subscription. The model calls themselves returned successful, complete responses, but
several worker attempts ended with `Could not parse a tailored résumé from the model
response`; rerunning the same rows eventually succeeded.

A read-only audit of the worker logs and Claude session transcripts found one repeated
cause. The tailoring prompt's example displayed literal paragraph breaks inside the
quoted `cover_letter` value. Claude sometimes copied those raw breaks instead of emitting
JSON `\n` escapes. The object was balanced and the résumé patch was usable, but raw control
characters inside a JSON string make the entire object invalid to `JSON.parse`. Across the
fourteen observed Profile 3 responses, seven had this exact format defect. Retrying spent
another subscription call and succeeded only when the model happened to escape the same
paragraph breaks.

The worker must not broadly "fix" arbitrary model output: guessing missing quotes,
commas, fields, or truncated content could change meaning and weaken the existing
anti-fabrication boundary.

## Decision

Use two narrow defenses at the shared model-response boundary:

1. The worker prompt now demonstrates a valid JSON string with visible `\n` escape
   sequences and explicitly forbids literal line breaks inside quoted values.
2. App and worker `extractJsonObject` first parse the untouched balanced object. Only
   when that fails, they escape raw U+0000–U+001F control characters found *inside a
   quoted JSON string* and attempt `JSON.parse` once more. They do not infer or repair
   any other syntax.

The repaired object continues through the existing normalization and `mergeTailored`
guards. Employers, dates, education, custom-section facts, and bullet limits remain
anchored to the authenticated user's Base résumé. No second LLM call is made
automatically. `/version` advertises `tailor-json-control-repair` for deployment checks.

## Consequences

- A raw paragraph break in an otherwise-valid `cover_letter` no longer discards the
  résumé produced in the same paid call.
- The repair is semantics-preserving: a raw newline becomes the JSON encoding of that
  same newline. It does not fabricate résumé content or missing structure.
- Truncated or otherwise malformed responses still fail visibly and remain manually
  retryable under ADR 0060.
- The app and worker copies need mirrored tests. The worker requires a restart after
  deployment; no schema, credential, environment, or account-data migration is needed.
