# ADR 0055 — Tailoring may reframe job titles (discipline, not level)

**Status:** accepted · **Date:** 2026-07-02 · **Loosens:** ADR 0026's hard anchor on `work[].position` · **Builds on:** ADR 0054 (title alignment for the headline)

## Context
ADR 0054 aligned the résumé HEADLINE (`basics.label`) with the target job title — the strongest
measured shortlisting signal — but each role's own title stayed hard-anchored to the base
(`mergeTailored` restored it even if the model changed it). The user generates a résumé, sees the
job titles untouched, and asked for titles to be tailorable too, with the change clearly visible
in the before/after review.

## Decision
- **Merge** (`lib/resumeTailor.ts` + the production port `resume-worker/tailor.js`):
  `mergeTailored` now takes the model's `work[i].position` when non-empty (em-dash-cleaned and
  YoE-clamped); empty/omitted keeps the base title. Employer names, dates, locations, contact,
  and education remain hard-anchored — titles are the ONE loosened field.
- **Prompt** (both copies): new JOB TITLES section — reframe the DISCIPLINE ("Software Engineer"
  doing frontend work → "Frontend Engineer"), never the LEVEL (no invented promotions; no
  Senior/Staff/Lead/Principal unless that role's base title already says it); the change must
  survive a reference check. The JSON schema's work entries gained an optional `"position"`.
- **Disclosure is deterministic, not model-reported:** new `titleChanges(base, merged)` compares
  positions and emits `Company: "old" → "new"` strings into `TailorChanges.titleChanges`
  (optional field — old rows still parse). Rendered as a "Job titles adjusted" section in
  ChangesReview, included in the download confirm dialog, and counted by `hasChanges`.
- **Diff view:** no change needed — ResumeDiff already diffs `position` per role, so the
  before/after view shows the old title struck through next to the new one.

## Consequences
- A model-inflated seniority (e.g. "Staff Engineer") would be ACCEPTED by the merge — the guard
  is prompt-level plus the mandatory review/confirm step, consistent with how added skills and
  embellished bullets are governed (the user reviews every résumé before applying).
- The Worker Mac must `git pull` + restart to pick this up for the production tailor path.
- The tailored ATS check now benefits: a reframed title feeds the title-alignment component.
