-- LinkedIn query refinement + career-sites portal (ADR 0058).
--
-- linkedin_experience_levels: LinkedIn f_E facet values ('1' Internship … '6'
-- Executive) baked into the search URL, so filtered-out jobs are never fetched
-- or billed by the pay-per-result actor. Empty = no filter.
--
-- career_sites_max_jobs: per-run result cap for the (opt-in, OFF by default)
-- fantastic.jobs Career Site actor — it bills $12/1k jobs on the free tier, so
-- this cap is the spend dial. 150 ≈ $1.80/run on free tier.
alter table settings add column if not exists linkedin_experience_levels text[] not null default '{}';
alter table settings add column if not exists career_sites_max_jobs integer not null default 150;
