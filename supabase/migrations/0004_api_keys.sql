-- API key vault (ADR 0006). Lets the single user manage multiple keys per
-- provider from the Settings UI and switch which one is active, instead of
-- editing Vercel env vars. Env vars remain an automatic fallback (see
-- lib/credentials.ts), so an empty vault keeps working.
-- Run this in the Supabase SQL editor, or via `supabase db push`.

create table if not exists api_keys (
  id          uuid primary key default gen_random_uuid(),
  provider    text not null
                check (provider in ('gemini','openai','deepseek','anthropic','apify')),
  label       text not null default '',
  key_value   text not null,            -- stored plaintext; reachable only via the service-role key
  is_active   boolean not null default false,
  created_at  timestamptz not null default now()
);

-- At most one active key per provider (partial unique index).
create unique index if not exists api_keys_one_active_per_provider
  on api_keys (provider) where is_active;
create index if not exists api_keys_provider_idx on api_keys (provider);
