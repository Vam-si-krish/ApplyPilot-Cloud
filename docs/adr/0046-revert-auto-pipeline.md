# ADR 0046 — Revert the fully-automatic pipeline

## Status
Accepted (2026-06-30) — reverses [ADR 0044](0044-fully-automatic-shortlist-pipeline.md) and the
ADR 0045 Dashboard funnel.

## Context
ADR 0044 wired every stage of the discovery→shortlist funnel into one unattended chain that
ran end-to-end on every fetch (archive no-skill-match → score → archive low-score → assess →
send top-N to Tailor & Apply), gated by a single `auto_pipeline_enabled` flag. ADR 0045 added a
live Dashboard funnel to visualize it.

The user decided they don't want the automatic chain. They still want the app's individual
capabilities — manual fetch, scoring, company assessment, and especially the résumé **tailoring**
that runs on their Claude subscription (ADR 0042/0043) — but not the auto-glue that archives and
auto-queues jobs without a click.

## Decision
Remove the auto-pipeline and its dashboard visualization, leaving every other capability intact:

- Deleted the pipeline glue: the skill-match archive at score-batch START, the low-score archive
  + top-N→Tailor finish in assess-batch, and the `score-batch → assess-batch` kick that fired on
  `auto_pipeline_enabled`. score-batch's `finishUp` again triggers assess only on
  `auto_assess_enabled`; assess-batch is back to a pure company-assessment stage.
- Removed the `lib/db.ts` helpers that only served the pipeline: `archiveBelowSkillMatch`,
  `archiveAtOrBelowScore`, `getTopJobsForTailoring`.
- Removed the three `Settings` fields (`auto_pipeline_enabled`, `pipeline_score_cutoff`,
  `pipeline_top_n`), their Settings-page "Auto Pipeline" section, and their request-body handlers.
  Migration `0031_drop_auto_pipeline.sql` drops the columns 0030 added.
- Deleted the Dashboard funnel: `components/PipelineFunnel.tsx`, `GET /api/pipeline`, and the
  `<PipelineFunnel />` mount on the Dashboard.

## What is deliberately kept
- **Résumé tailoring on the Claude subscription** (ADR 0042) and the **overnight tailoring queue**
  (ADR 0043) — untouched. Jobs still reach Tailor & Apply via the existing manual "Send to Tailor
  & Apply" action.
- The manual chain: fetch → score (frozen rubric, ADR 0022) → company assessment (ADR 0010),
  each still triggerable on its own.
- The **timezone dropdown** in Settings (added in the same 0044 commit but independent of the
  pipeline) — kept.

## Consequences
- No job is ever archived or auto-queued without an explicit user action again.
- The dropped DB columns are gone from the live schema; `getSettings` no longer surfaces them.
- History preserved: ADR 0044 is marked Reverted rather than deleted.
