-- Pre-scoring relevance filter (ADR 0008). A cheap, local (no-API) résumé↔job
-- match score gates which jobs reach the LLM scorer, cutting token waste on
-- obviously-irrelevant postings.
-- Run this in the Supabase SQL editor, or via `supabase db push`.

-- jobs: add a 'filtered' status (below-threshold jobs that skipped LLM scoring)
-- and store the 0–100 match score for transparency.
alter table jobs drop constraint if exists jobs_status_check;
alter table jobs add constraint jobs_status_check
  check (status in ('unscored','scored','archived','filtered'));
alter table jobs add column if not exists prefilter_score int;  -- 0–100; null = not computed
alter table jobs drop constraint if exists prefilter_score_range;
alter table jobs add constraint prefilter_score_range
  check (prefilter_score is null or (prefilter_score >= 0 and prefilter_score <= 100));

-- settings: toggle + threshold (percent). Default off so behaviour is unchanged
-- until the user opts in.
alter table settings add column if not exists prefilter_enabled boolean not null default false;
alter table settings add column if not exists prefilter_threshold int not null default 30;
