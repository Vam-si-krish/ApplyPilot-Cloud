-- ApplyPilot-Cloud schema (ADR 0001).
-- Column names derive from the ApplyPilot-Lite /api/jobs SELECT, with
-- score_keywords split out as its own column (see docs/ARCHITECTURE.md).
-- Run this in the Supabase SQL editor, or via `supabase db push`.

create extension if not exists "pgcrypto";

-- ── jobs ─────────────────────────────────────────────────────────────────────
create table if not exists jobs (
  id                uuid primary key default gen_random_uuid(),
  url               text not null unique,
  title             text,
  company           text,
  location          text,
  salary            text,
  full_description  text,
  application_url   text,
  fit_score         int,                       -- 0–10; null = unscored. 0 = invalid content.
  score_note        text,
  score_keywords    text,
  score_reasoning   text,
  status            text not null default 'unscored'
                      check (status in ('unscored','scored','archived')),
  is_shortlisted    boolean not null default false,
  discovered_at     timestamptz not null default now(),
  scored_at         timestamptz,
  source            text,
  constraint fit_score_range check (fit_score is null or (fit_score >= 0 and fit_score <= 10))
);

create index if not exists jobs_status_idx        on jobs (status);
create index if not exists jobs_fit_score_idx      on jobs (fit_score desc nulls last);
create index if not exists jobs_discovered_at_idx  on jobs (discovered_at desc);

-- ── profile (single row, id = 1) ─────────────────────────────────────────────
create table if not exists profile (
  id                  int primary key default 1 check (id = 1),
  personal            jsonb not null default '{}'::jsonb,
  experience          jsonb not null default '{}'::jsonb,
  compensation        jsonb not null default '{}'::jsonb,
  work_authorization  jsonb not null default '{}'::jsonb,
  skills_boundary     jsonb not null default '{}'::jsonb,
  resume_text         text  not null default '',
  resume_pdf_path     text,
  updated_at          timestamptz not null default now()
);
insert into profile (id) values (1) on conflict (id) do nothing;

-- ── settings (single row, id = 1) ────────────────────────────────────────────
create table if not exists settings (
  id                 int primary key default 1 check (id = 1),
  schedule_time      text not null default '06:00',
  timezone           text not null default 'America/New_York',
  keywords           text[] not null default array['Software Engineer']::text[],
  locations          text[] not null default array['United States']::text[],
  hours_old          int  not null default 24,
  results_per_query  int  not null default 50,
  llm_provider       text not null default 'gemini',
  llm_model          text not null default 'gemini-2.0-flash',
  apify_actor_id     text not null default 'bebity~linkedin-jobs-scraper',
  auto_scrape_enabled boolean not null default true,
  updated_at         timestamptz not null default now()
);
insert into settings (id) values (1) on conflict (id) do nothing;

-- ── runs (one row per scheduled/manual run) ─────────────────────────────────
create table if not exists runs (
  id            uuid primary key default gen_random_uuid(),
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  jobs_found    int not null default 0,
  jobs_scored   int not null default 0,
  errors        int not null default 0,
  apify_run_id  text,
  status        text not null default 'running'
                  check (status in ('running','succeeded','failed'))
);
create index if not exists runs_started_at_idx on runs (started_at desc);
