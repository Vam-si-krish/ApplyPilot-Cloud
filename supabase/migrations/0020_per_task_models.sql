-- Per-task AI models: let scoring (high-volume) use a cheap, consistent model while
-- tailoring (quality, truthful rewriting) uses a premium one. Each task resolves its
-- own provider+model and the active vault key for that provider; a null task field
-- falls back to the global llm_provider/llm_model.
-- Defaults: scoring → OpenAI gpt-4o-mini · tailoring → Anthropic Claude Sonnet 4.6.

alter table settings add column if not exists score_provider  text default 'openai';
alter table settings add column if not exists score_model     text default 'gpt-4o-mini';
alter table settings add column if not exists tailor_provider text default 'anthropic';
alter table settings add column if not exists tailor_model    text default 'claude-sonnet-4-6';
