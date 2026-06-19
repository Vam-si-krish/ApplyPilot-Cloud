-- Token-saving controls (ADR 0019).
--  * min_skill_match: in the auto pipeline, jobs whose skill_match_score is below
--    this are marked 'filtered' and skipped (no LLM call). 0 = off; 1 = "require
--    at least one of my skills". The actor has no skill filter, so we gate locally.
--  * max_jobs_per_run: hard cap on jobs fetched per run (caps the actor maxItems);
--    0 = no cap (use results_per_role × combos). Stops 700-job blowups.
-- Run in the Supabase SQL editor, or via `supabase db push`.

alter table settings add column if not exists min_skill_match  int not null default 0;
alter table settings add column if not exists max_jobs_per_run int not null default 0;
