# ADR 0050 — Drop tailored-résumé scoring

**Status:** accepted · **Date:** 2026-07-01 · supersedes the tailored-scoring part of [ADR 0029](0029-tailoring-length-and-applications-scores.md)

## Context
ADR 0029 added a second fit score: after a résumé was tailored (manual "Generate", bulk
generate, and the nightly `/tailor-queue` drain), the worker re-scored the **tailored** résumé
against the job with the **same frozen `SCORE_PROMPT`**, storing `tailored_fit_score` /
`tailored_score_note` and showing a "Résumé X/10 (+delta vs base)" badge on Tailor & Apply rows.

Two problems, surfaced by the user:

1. **Redundant tokens.** It was one extra LLM call per résumé, re-run on every (re)generation and
   on every nightly drain — the highest-cost, lowest-value step in the tailoring pipeline. On the
   Claude subscription it also re-sent the full prompt + 15k-char job description with poor cache
   reuse (the résumé differs from the base-scoring call).

2. **The delta is not meaningful with this rubric.** `SCORE_PROMPT` is deliberately
   *tailoring-aware*: it tells the model "the candidate WILL tailor their résumé… judge fit as how
   competitive a strong tailored version would be" and to "credit a skill the base résumé only
   mentions in passing — a tailored résumé will foreground it." So the **base** `fit_score` already
   answers "how good is this once tailored?". Running the same rubric on an **already-tailored**
   résumé double-counts that uplift, so the base→tailored delta is muddy (often ~0 or negative) and
   the "+N" badge misleads rather than informs.

## Decision
Remove tailored-résumé scoring entirely. The base `fit_score` is the single, tailoring-aware fit
signal; there is no second score.

- **Worker `runFullPipeline`** (nightly queue + generate): drop step 3 (score tailored résumé) and
  the `scoreClient` it required; the drain now only **tailors → renders**. `/tailor-queue` no longer
  builds a scoring client; the unused `resumeToScoringText` import is removed. (`scoreJobWorker` and
  `resumeToScoringText` stay — base job scoring via `/score-jobs` still uses them.)
- **Applications UI**: remove the auto-score after single and bulk generate, the `TailoredScoreChip`
  (badge / spinner / "Score résumé" button), the `scoreTailored` handler, and its state.
- **Route**: delete `POST /api/applications/[id]/score-tailored`.
- **Schema**: `tailored_fit_score` / `tailored_score_note` columns are **kept** (no migration) but
  are no longer written by the pipeline. The Jobs-tab "Delete tailored résumé" action (ADR 0048)
  still nulls them alongside the résumé, cleaning up any legacy values.

## Consequences
- One fewer LLM call per tailored résumé — every generation and the whole nightly drain get cheaper,
  which is most noticeable on the token-metered Claude subscription.
- Tailor & Apply rows show the base **Job fit** chip (and company tier) but no separate résumé score.
- **Worker redeploy required** for the pipeline change to take effect on the Worker Mac; until then
  the old worker would still score tailored résumés, which is harmless (just the extra call).
- If a per-résumé fit signal is ever wanted again, it should use a *tailored-specific* prompt
  ("this résumé is already tailored for this job — score as-is"), not the base rubric — the reason
  the naive same-rubric version was dropped.
