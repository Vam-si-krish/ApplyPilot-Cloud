-- Skill-match scoring (ADR 0018). The user lists their skills; the LinkedIn actor
-- (cheap_scraper) takes them as `resumeKeywords` and tags each job with how many it
-- matches — a free, no-LLM signal of skill fit, separate from the AI fit score.
-- Run in the Supabase SQL editor, or via `supabase db push`.

-- The skills to match against each job (passed to the actor as resumeKeywords).
alter table settings add column if not exists skills text[] not null default '{}'::text[];

-- Per-job skill-match outputs from the actor.
alter table jobs add column if not exists skill_match_score int;          -- 0–100, null = not computed
alter table jobs add column if not exists matched_skills    text[];        -- your skills the job mentions
alter table jobs add column if not exists unmatched_skills  text[];        -- your skills it doesn't
