-- Auto-rotate API keys (ADR 0007). When true, /api/run advances each provider's
-- active key to the next stored one (round-robin) at the start of every run, so
-- usage spreads across multiple accounts. Default false = use the manually chosen
-- active key (ADR 0006 behaviour).
-- Run this in the Supabase SQL editor, or via `supabase db push`.

alter table settings add column if not exists auto_rotate_keys boolean not null default false;
