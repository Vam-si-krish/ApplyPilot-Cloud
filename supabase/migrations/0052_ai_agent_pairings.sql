-- Single-use, short-lived pairing codes let a local MCP process obtain a scoped run
-- without exposing a bearer token in the ApplyPilot browser UI (ADR 0099).
create table if not exists public.ai_agent_pairings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default public.request_user_id(),
  code_hash text not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint ai_agent_pairings_user_id_fkey foreign key (user_id)
    references public.app_users(id) on delete cascade,
  constraint ai_agent_pairings_code_hash_check check (code_hash ~ '^[0-9a-f]{64}$'),
  constraint ai_agent_pairings_expiry_check check (expires_at > created_at)
);

create index if not exists ai_agent_pairings_user_active_idx
  on public.ai_agent_pairings (user_id, expires_at desc)
  where consumed_at is null;

alter table public.ai_agent_pairings enable row level security;
alter table public.ai_agent_pairings force row level security;
drop policy if exists user_ownership_policy on public.ai_agent_pairings;
create policy user_ownership_policy on public.ai_agent_pairings
  using (public.request_has_service_scope() or user_id = public.request_user_id())
  with check (public.request_has_service_scope() or user_id = public.request_user_id());

notify pgrst, 'reload schema';
