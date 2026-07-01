# ADR 0029 — Length-neutral tailoring, tailored-résumé scoring, and visible bulk progress

## Status
Accepted (2026-06-23) — the **tailored-résumé scoring** portion is superseded by
[ADR 0050](0050-drop-tailored-resume-scoring.md) (2026-07-01); length-neutral tailoring and
the bulk-progress toast remain in force.

## Context
Three issues from real use:

1. **Tailoring overflowed one page.** The tailorer was told it could "EXPAND" bullets
   and freely add points, so a tight one-page base résumé came back with extra bullets
   and spilled onto a second page (the worker's PDF auto-fit then shrank everything).
2. **Scoring feedback was invisible / the wrong control.** The auto-scorer surfaced a
   "Score now (482 waiting)" button — but the user wants to choose *which* jobs get
   scored (select in the last 24h, filter, then score). And selection scoring/company
   assessment only showed a tiny inline "5/25" text, easy to miss.
3. **Applications hid the signals.** After moving jobs into Applications, the row showed
   nothing about the original job fit, the AI company tier, or how the *tailored* résumé
   scores — the user wanted all three side by side.

## Decision

**Length-neutral tailoring.** The `TAILOR_PROMPT` (in `lib/resumeTailor.ts` and the
worker copy `resume-worker/tailor.js`) now hard-requires the tailored résumé to be the
same length or shorter: **never increase the bullet count** in any role/project. To
surface a job-relevant point the model must REPLACE/MERGE the least-important existing
bullet (or modify one) — "add one, remove one." Skills may still be added (compact). As
a guarantee independent of model compliance, `mergeTailored` caps each role/project's
highlights to the base count (`capHighlights`) — the model is told to order by
importance, so trimming overflow only drops its least-important bullet.

**User-driven scoring + visible progress.** Removed the auto-start "Score now" button
from `ScoringPanel` (Dashboard + Jobs); the panel now only *surfaces* an already-running
automatic pass (daily run / webhook) with a Stop button. The user scores by selecting
jobs on the Jobs page. Selection scoring and company assessment now drive a fixed,
always-visible `ProgressToast` (bottom-right, `done/total` bar) instead of the tiny inline
text, and refresh the list live as each chunk lands.

**Three scores in Applications.** New `applications.tailored_fit_score` /
`tailored_score_note` (migration 0024). After a résumé is generated it's scored against
the job via `POST /api/applications/[id]/score-tailored` (one fast LLM call, reusing the
standard scorer over a `resumeToText()` rendering of the tailored doc). The Applications
row shows three chips: **Job fit** (original `job.fit_score`), **company tier**
(`CompanyTierBadge`), and **Résumé X/10** with the delta vs the original. Regenerating
clears the old tailored score (worker writes null) and the app re-scores; older rows get
a one-click "Score résumé".

## Consequences
- Tailored résumés stay one page; the lift is now measurable (tailored vs original fit).
- Scoring is explicitly user-controlled; progress is unmissable and consistent with the
  Gmail-style pattern.
- New surface: migration 0024, `/api/applications/[id]/score-tailored`, `resumeToText`,
  `ProgressToast`, score chips. The frozen fit-scoring rubric is reused unchanged (the
  tailored résumé is just another résumé to score).
- The cap is a blunt safety net: if a base role legitimately has very few bullets, the
  tailorer can't add net-new ones there — by design (length discipline over verbosity).
