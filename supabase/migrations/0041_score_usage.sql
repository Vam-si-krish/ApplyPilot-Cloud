-- Per-score token/cache/cost usage (ADR 0066).
-- When scoring runs on the Claude subscription (Agent SDK) or direct-API Anthropic, the
-- provider reports tokens in/out, cache read/write, and a $ cost. We persist it per job so
-- the Jobs UI can show how much of the résumé prefix was served from cache vs. re-billed
-- (the payoff of moving the résumé into a cached system message and enriching it past
-- Haiku's 4096-token cache minimum). Shape mirrors the ScoreUsage type in lib/types.ts.
-- Run this in the Supabase SQL editor, or via `supabase db push`.

alter table jobs add column if not exists score_usage jsonb;
