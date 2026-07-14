-- Phase 2A: three fixed accounts with database-enforced ownership (ADR 0073).
-- Passwords stay in Netlify APP_USERS_JSON; this table contains identity metadata only.

create table if not exists public.app_users (
  id uuid primary key,
  username text not null unique,
  display_name text not null default '',
  onboarding_complete boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.app_users (id, username, display_name) values
  ('00000000-0000-4000-8000-000000000001', 'vamsi', 'Vamsi'),
  ('00000000-0000-4000-8000-000000000002', 'pilot2', 'Pilot 2'),
  ('00000000-0000-4000-8000-000000000003', 'pilot3', 'Pilot 3')
on conflict (id) do update set
  username = excluded.username,
  display_name = excluded.display_name;

-- PostgREST exposes verified JWT claims through this transaction-local setting.
create or replace function public.request_claims()
returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;

create or replace function public.request_user_id()
returns uuid language sql stable as $$
  select nullif(public.request_claims()->>'user_id', '')::uuid
$$;

-- Direct migration/maintenance connections have no request claims. Gateway service
-- requests carry scope=service; ordinary application requests carry scope=user.
create or replace function public.request_has_service_scope()
returns boolean language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true), '') is null
      or public.request_claims()->>'scope' = 'service'
$$;

alter table public.jobs add column if not exists user_id uuid;
alter table public.profile add column if not exists user_id uuid;
alter table public.settings add column if not exists user_id uuid;
alter table public.runs add column if not exists user_id uuid;
alter table public.api_keys add column if not exists user_id uuid;
alter table public.gmail_connection add column if not exists user_id uuid;
alter table public.mail_messages add column if not exists user_id uuid;
alter table public.applications add column if not exists user_id uuid;
alter table public.scoring_state add column if not exists user_id uuid;

do $$
declare t text;
begin
  foreach t in array array[
    'jobs','profile','settings','runs','api_keys','gmail_connection','mail_messages',
    'applications','scoring_state'
  ] loop
    execute format(
      'update public.%I set user_id = %L where user_id is null',
      t, '00000000-0000-4000-8000-000000000001'
    );
    execute format('alter table public.%I alter column user_id set not null', t);
    execute format(
      'alter table public.%I alter column user_id set default public.request_user_id()', t
    );
    execute format(
      'alter table public.%I drop constraint if exists %I', t, t || '_user_id_fkey'
    );
    execute format(
      'alter table public.%I add constraint %I foreign key (user_id) references public.app_users(id) on delete cascade',
      t, t || '_user_id_fkey'
    );
  end loop;
end $$;

-- Singleton rows stay id=1, but id is now unique only inside the RLS-visible account.
alter table public.profile drop constraint if exists profile_pkey;
alter table public.profile drop constraint if exists profile_id_check;
alter table public.profile add constraint profile_id_check check (id = 1);
alter table public.profile add constraint profile_pkey primary key (user_id);

alter table public.settings drop constraint if exists settings_pkey;
alter table public.settings drop constraint if exists settings_id_check;
alter table public.settings add constraint settings_id_check check (id = 1);
alter table public.settings add constraint settings_pkey primary key (user_id);

alter table public.gmail_connection drop constraint if exists gmail_connection_pkey;
alter table public.gmail_connection drop constraint if exists gmail_connection_id_check;
alter table public.gmail_connection add constraint gmail_connection_id_check check (id = 1);
alter table public.gmail_connection add constraint gmail_connection_pkey primary key (user_id);

alter table public.scoring_state drop constraint if exists scoring_state_pkey;
alter table public.scoring_state drop constraint if exists scoring_state_singleton;
alter table public.scoring_state add constraint scoring_state_singleton check (id = 1);
alter table public.scoring_state add constraint scoring_state_pkey primary key (user_id);

insert into public.profile (id, user_id) values
  (1, '00000000-0000-4000-8000-000000000002'),
  (1, '00000000-0000-4000-8000-000000000003')
on conflict (user_id) do nothing;
insert into public.settings (id, user_id, auto_scrape_enabled) values
  (1, '00000000-0000-4000-8000-000000000002', false),
  (1, '00000000-0000-4000-8000-000000000003', false)
on conflict (user_id) do nothing;
insert into public.gmail_connection (id, user_id) values
  (1, '00000000-0000-4000-8000-000000000002'),
  (1, '00000000-0000-4000-8000-000000000003')
on conflict (user_id) do nothing;
insert into public.scoring_state (id, user_id) values
  (1, '00000000-0000-4000-8000-000000000002'),
  (1, '00000000-0000-4000-8000-000000000003')
on conflict (user_id) do nothing;

-- Uniqueness is per account, not global.
alter table public.jobs drop constraint if exists jobs_url_key;
alter table public.jobs drop constraint if exists jobs_user_url_key;
alter table public.jobs add constraint jobs_user_url_key unique (user_id, url);

drop index if exists public.api_keys_one_active_per_provider;
create unique index api_keys_one_active_per_user_provider
  on public.api_keys (user_id, provider) where is_active;

alter table public.mail_messages drop constraint if exists mail_messages_gmail_id_key;
alter table public.mail_messages drop constraint if exists mail_messages_user_gmail_id_key;
alter table public.mail_messages add constraint mail_messages_user_gmail_id_key unique (user_id, gmail_id);

alter table public.applications drop constraint if exists applications_job_id_key;
alter table public.applications drop constraint if exists applications_user_job_id_key;
alter table public.applications add constraint applications_user_job_id_key unique (user_id, job_id);

-- Composite keys make cross-account relationships impossible even with known UUIDs.
alter table public.runs drop constraint if exists runs_user_id_id_key;
alter table public.runs add constraint runs_user_id_id_key unique (user_id, id);
alter table public.jobs drop constraint if exists jobs_user_id_id_key;
alter table public.jobs add constraint jobs_user_id_id_key unique (user_id, id);

alter table public.jobs drop constraint if exists jobs_run_id_fkey;
alter table public.jobs add constraint jobs_run_user_fkey
  foreign key (user_id, run_id) references public.runs(user_id, id) on delete set null (run_id);
alter table public.jobs drop constraint if exists jobs_duplicate_of_fkey;
alter table public.jobs add constraint jobs_duplicate_user_fkey
  foreign key (user_id, duplicate_of) references public.jobs(user_id, id) on delete set null (duplicate_of);
alter table public.applications drop constraint if exists applications_job_id_fkey;
alter table public.applications add constraint applications_job_user_fkey
  foreign key (user_id, job_id) references public.jobs(user_id, id) on delete cascade;

create index if not exists jobs_user_status_idx on public.jobs (user_id, status);
create index if not exists runs_user_started_idx on public.runs (user_id, started_at desc);
create index if not exists applications_user_status_idx on public.applications (user_id, status);
create index if not exists mail_messages_user_received_idx on public.mail_messages (user_id, received_at desc);
create index if not exists api_keys_user_provider_idx on public.api_keys (user_id, provider);

-- Forced RLS protects against missed filters in application code, including table-owner
-- requests. The gateway is responsible for issuing scope=user or scope=service claims.
alter table public.app_users enable row level security;
alter table public.app_users force row level security;
drop policy if exists app_users_owner_policy on public.app_users;
create policy app_users_owner_policy on public.app_users
  using (public.request_has_service_scope() or id = public.request_user_id())
  with check (public.request_has_service_scope() or id = public.request_user_id());

do $$
declare t text;
begin
  foreach t in array array[
    'jobs','profile','settings','runs','api_keys','gmail_connection','mail_messages',
    'applications','scoring_state'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('drop policy if exists user_ownership_policy on public.%I', t);
    execute format(
      'create policy user_ownership_policy on public.%I using (public.request_has_service_scope() or user_id = public.request_user_id()) with check (public.request_has_service_scope() or user_id = public.request_user_id())',
      t
    );
  end loop;
end $$;
