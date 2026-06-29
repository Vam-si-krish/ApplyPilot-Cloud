# ADR 0044 — Fully-automatic discovery → shortlist pipeline

## Status
Accepted (2026-06-29)

## Context
The app already had every *stage* of a discovery-to-shortlist funnel, but the user had to
drive the transitions by hand: run a fetch, watch scoring, eyeball the Jobs list, manually
send picks to Tailor & Apply. The user wants one unattended chain that, on every daily
fetch, narrows the day's postings down to a tailored shortlist with no clicks:

1. Fetch with the saved filters.
2. Drop jobs with **no skill match** (a cheap résumé↔posting overlap, ADR 0008/0018) *before*
   spending any LLM call.
3. Score every survivor (the frozen rubric, ADR 0022 — one call per job).
4. Drop jobs scoring **≤ 5**.
5. Assess the companies behind the survivors (ADR 0009/0010).
6. Send the **top 50** highest-scoring jobs at acceptable companies to **Tailor & Apply**,
   where the overnight queue (ADR 0043) auto-tailors them.

## Decision
Reuse the existing decoupled chain (`/api/run → webhook → /api/score-batch (loop) →
/api/assess-batch (loop)`, ADR 0004) and hook the new stages into its transition points
rather than building a separate orchestrator. A single flag, `auto_pipeline_enabled`, gates
the whole thing; two knobs (`pipeline_score_cutoff` default 5, `pipeline_top_n` default 50)
tune it. The skill-match gate **reuses** the existing `min_skill_match` column.

- **Reject = ARCHIVE, never hard-delete.** Both cull stages set `status='archived'`
  (`archiveBelowSkillMatch`, `archiveAtOrBelowScore` in [lib/db.ts](../../lib/db.ts)). Archived
  rows leave the active Jobs list and the unscored/assess queues but stay recoverable and are
  **not re-fetched or re-scored** — avoiding the churn (and re-spent LLM calls) a hard delete +
  re-fetch would cause. Same end-user effect (they vanish from view), reversible.
- **Stage placement — at the chain's natural seams, each idempotent:**
  - Stage 2 (no-skill-match archive) runs once at **scoring START** (the `!token` branch of
    [score-batch](../../app/api/score-batch/route.ts)) — only `unscored` rows with a non-null
    `skill_match_score` below the threshold; a **null** score (skills unset / actor gave none)
    is left to be scored, so the gate never silently drops everything.
  - Stage 4 (low-score archive) runs at **assessment START** (the top of
    [assess-batch](../../app/api/assess-batch/route.ts)), so company-assessment LLM calls are
    spent only on survivors. Only touches `scored` rows ≤ cutoff (can't race the scorer).
  - Stage 6 (top-N → Tailor & Apply) runs once when **assessment drains** (`finishPipeline`):
    `getTopJobsForTailoring` takes `scored` jobs, drops `low`-tier companies (keeps
    `good`/`medium`/`unknown` — an employer the model couldn't rate isn't punished), orders by
    `fit_score` desc, caps at N, and `addApplications` upserts them as `status='queued'`
    (idempotent on `job_id`).
- **The pipeline forces the assess stage to run.** `finishUp` in score-batch now triggers
  `/api/assess-batch` when `auto_assess_enabled` **OR** `auto_pipeline_enabled` — because the
  pipeline's stages 4 & 6 live in that route and must run even if the user left company
  assessment itself off.

## Consequences
- **Scoring discipline preserved (CLAUDE.md):** the cull stages are pure DB status updates;
  scoring stays one LLM call per job with the frozen rubric, errors → visible score 0.
- **Idempotent + safe to re-run.** Every stage only touches rows in the right state and the
  final send upserts-ignoring-duplicates, so an overlapping run or a re-trigger can't
  double-archive or double-queue. Single-flight scoring (ADR 0028) still holds.
- **Fully automatic (the chosen trigger).** Every fetch runs the whole chain unattended; a
  bad filter value auto-archives/auto-queues with no confirmation. Mitigations: archive (not
  delete) is reversible, `auto_pipeline_enabled` defaults **off**, and the cutoffs are bounded
  in the settings API (cutoff 0–10, top-N 1–500).
- **Composes with ADR 0043:** the top-N land as `queued` applications, which the overnight
  tailoring queue then drains — so "fetch today → tailored shortlist by morning" is one
  unattended path. Note both this chain's self-triggers and the daily fetch run through the
  cloud app; the overnight tailoring trigger is the Worker Mac (the app is on Netlify — see
  ADR 0043 and the deploy-is-Netlify note).
- **Timezone picker:** Settings now offers a US-zone dropdown (Eastern default) instead of a
  free-text IANA field, preserving any previously-saved custom value.
