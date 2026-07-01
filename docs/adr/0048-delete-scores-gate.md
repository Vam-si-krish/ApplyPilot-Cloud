# ADR 0048 — Bulk-delete scores, gated behind a Settings toggle

**Status:** accepted · **Date:** 2026-07-01 · supersedes [ADR 0039](0039-rescore-safety-gate.md)

## Context
ADR 0039 added `allow_rescore` — a Settings gate that, when on, let "Score selected" *re-score*
already-scored jobs (overwrite in place). In practice the user wanted the inverse primitive: the ability
to **delete** a job's scores (and its tailored résumé) so it goes back to a clean state — with the same
"deliberate, hard to fire by accident" safety property. Deleting the fit score also gives re-scoring for
free: a job reset to `unscored` re-enters the normal scoring path, so a separate re-score gate is
redundant.

## Decision
**Repurpose** the toggle: rename `settings.allow_rescore` → **`allow_delete_scores`** (default false).
When on, the Jobs tab reveals bulk **delete** actions on the selected jobs; when off, they're hidden and
the API refuses to run (double gate).

- **Migration 0032:** `alter table settings rename column allow_rescore to allow_delete_scores` — a
  rename preserves the existing value and keeps it one boolean. No re-score column remains.
- **New route `POST /api/jobs/clear-scores`** `{ ids, target }`, `target ∈ {fit, company, match,
  tailored}`. Session-gated (middleware) **and** gated again on `allow_delete_scores` server-side.
  Each target clears:
  - **fit** → `fit_score, score_note, score_keywords, score_reasoning, score_breakdown,
    employment_type, scored_at` = null and `status = 'unscored'` (re-enters the scoring queue).
  - **company** → `company_tier, company_tier_note` = null.
  - **match** → `skill_match_score, prefilter_score, matched_skills, unmatched_skills` = null.
  - **tailored** → on the linked `applications` row (by `job_id`): `tailored_resume, tailor_changes,
    tailored_fit_score, tailored_score_note` = null.
- **Jobs UI:** four red "Delete fit / company / match / tailored" buttons in the selection toolbar,
  shown only when the toggle is on, each with a confirm dialog; a rose banner flags that the gate is on.
- **Re-scoring path removed:** `/api/score-selected` and the worker's `/score-jobs` no longer read
  `allow_rescore`; both score only `unscored`/`filtered` rows. To re-score, delete the fit score first.

## Consequences
- Re-scoring is now a two-step, explicit flow (delete fit score → Score selected) rather than a toggle.
  This is cleaner: one mental model (delete resets to unscored) covers both "wipe a bad score" and
  "score it again."
- Destructive by nature, so it stays behind the off-by-default gate + per-action confirm + a visible
  banner while on.
- The worker must be **redeployed** for `/score-jobs` to drop the old `allow_rescore` read (see the
  Worker Mac note); until then it already scores only unscored jobs, matching the new behavior.
- Old code/tests referencing `allow_rescore` were migrated to `allow_delete_scores`.
