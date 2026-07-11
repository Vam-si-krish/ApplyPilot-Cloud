-- A third, independent AI lane for ApplyBuddy chat (ADR 0069).
--
-- Backfill from the existing scoring lane because chat used buildScoringClient before
-- this migration. Adding the columns WITHOUT a default first is intentional: Postgres
-- would otherwise fill existing rows with the new default and silently change the
-- user's current chat provider/model instead of preserving it.

alter table settings add column if not exists chat_provider text;
alter table settings add column if not exists chat_model text;

update settings
set
  chat_provider = coalesce(nullif(chat_provider, ''), nullif(score_provider, ''), nullif(llm_provider, ''), 'openai'),
  chat_model = coalesce(nullif(chat_model, ''), nullif(score_model, ''), nullif(llm_model, ''), 'gpt-4o-mini');

alter table settings alter column chat_provider set default 'openai';
alter table settings alter column chat_model set default 'gpt-4o-mini';
