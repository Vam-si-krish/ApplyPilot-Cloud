-- Scoring v2 (ADR 0022): a weighted, must-have-aware rubric that also reports the
-- employment type, so contract/staffing roles can be flagged (and not unfairly
-- demoted by the company assessment).
--  * score_breakdown — per-dimension sub-scores + missing must-haves + seniority fit
--  * employment_type  — full_time | contract | internship | unknown (from the scorer)
-- Run in the Supabase SQL editor, or via `supabase db push`.

alter table jobs add column if not exists score_breakdown jsonb;
alter table jobs add column if not exists employment_type text
  check (employment_type in ('full_time', 'contract', 'internship', 'unknown'));

create index if not exists jobs_employment_type_idx on jobs (employment_type);
