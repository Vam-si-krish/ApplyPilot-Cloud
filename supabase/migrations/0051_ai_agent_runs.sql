-- Revocable, short-lived authorization records for the ApplyPilot MCP plugin (ADR 0096).
-- Raw bearer tokens are never stored. Their signed run/user claims are useful only while
-- the matching user-owned row remains active.
create table if not exists public.ai_agent_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default public.request_user_id(),
  label text not null default 'Codex MCP',
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  constraint ai_agent_runs_user_id_fkey foreign key (user_id)
    references public.app_users(id) on delete cascade,
  constraint ai_agent_runs_label_length_check check (char_length(label) between 1 and 80),
  constraint ai_agent_runs_expiry_check check (expires_at > created_at)
);

create index if not exists ai_agent_runs_user_active_idx
  on public.ai_agent_runs (user_id, expires_at desc)
  where revoked_at is null;

alter table public.ai_agent_runs enable row level security;
alter table public.ai_agent_runs force row level security;
drop policy if exists user_ownership_policy on public.ai_agent_runs;
create policy user_ownership_policy on public.ai_agent_runs
  using (public.request_has_service_scope() or user_id = public.request_user_id())
  with check (public.request_has_service_scope() or user_id = public.request_user_id());

notify pgrst, 'reload schema';
