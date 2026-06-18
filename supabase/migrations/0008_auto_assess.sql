-- Automated company-assessment stage (ADR 0010). After the daily run scores
-- jobs, the pipeline auto-assesses the companies behind high-scoring jobs
-- (fit_score >= auto_assess_min_score) so the main page can default to "good
-- jobs at good companies". Toggle off to keep company assessment on-demand only.
-- Run this in the Supabase SQL editor, or via `supabase db push`.

alter table settings add column if not exists auto_assess_enabled boolean not null default true;
alter table settings add column if not exists auto_assess_min_score int not null default 6;
