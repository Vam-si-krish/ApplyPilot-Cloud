-- 0031_drop_auto_pipeline.sql
-- Reverts the fully-automatic discovery→shortlist pipeline (ADR 0044, migration 0030).
-- The auto-pipeline was removed at the user's request: only the manual chain remains
-- (fetch → score → assess), and résumé tailoring stays as-is. Drops the settings columns
-- 0030 added; nothing in the code references them anymore. The skill-match gate keeps its
-- own existing min_skill_match column, which is untouched.
alter table settings drop column if exists auto_pipeline_enabled;
alter table settings drop column if exists pipeline_score_cutoff;
alter table settings drop column if exists pipeline_top_n;
