-- 0030_auto_pipeline.sql
-- Fully-automatic discovery→shortlist pipeline (ADR 0044). On every daily fetch the chain
-- runs end-to-end with no clicks: archive no-skill-match jobs → score → archive low-score
-- jobs → assess companies → send the top-N good/medium-company jobs to Tailor & Apply
-- (where the overnight queue, ADR 0043, auto-tailors them).
alter table settings add column if not exists auto_pipeline_enabled boolean not null default false;
-- Scored jobs with fit_score <= this are archived after scoring (the "≤ 5" cutoff). The
-- skill-match gate (stage 2) reuses the existing min_skill_match column.
alter table settings add column if not exists pipeline_score_cutoff integer not null default 5;
-- How many surviving (good/medium-company, highest-scoring) jobs are sent to Tailor & Apply.
alter table settings add column if not exists pipeline_top_n integer not null default 50;
