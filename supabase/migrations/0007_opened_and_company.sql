-- "Opened" tracking + AI company assessment (ADR 0009).
-- clicked_at: set when the user opens a job's apply link, so the row can show as
--   "opened" (where did I stop applying).
-- company_size / company_tier / company_tier_note: an on-demand LLM assessment of
--   the company behind a job (good/medium/low/unknown) to spot time-waster/spam
--   employers; company_size is captured from scrape data when available.
-- Run this in the Supabase SQL editor, or via `supabase db push`.

alter table jobs add column if not exists clicked_at timestamptz;
alter table jobs add column if not exists company_size text;
alter table jobs add column if not exists company_tier text;
alter table jobs drop constraint if exists company_tier_check;
alter table jobs add constraint company_tier_check
  check (company_tier is null or company_tier in ('good','medium','low','unknown'));
alter table jobs add column if not exists company_tier_note text;

create index if not exists jobs_clicked_at_idx on jobs (clicked_at);
