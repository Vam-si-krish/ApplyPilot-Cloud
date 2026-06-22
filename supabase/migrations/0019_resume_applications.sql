-- Custom per-job résumé generation — Phase 1 foundations (ADR 0024).
--   * profile.base_resume — the editable base résumé as structured JSON Resume
--     (jsonresume.org subset), parsed once from resume_text. Source of truth that
--     per-job tailoring reframes (never fabricates) into each application.
--   * applications — one row per job the user is preparing/applying to: holds the
--     tailored résumé JSON, the chosen template, render status, and the PDF path.
--   * resumes Storage bucket — generated PDFs, private (served via signed URLs).
-- Apply via psql or the Supabase SQL editor.

alter table profile add column if not exists base_resume jsonb;

create table if not exists applications (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  -- queued → generating → ready → applied (failed = render/AI error, retryable).
  status text not null default 'queued'
    check (status in ('queued', 'generating', 'ready', 'applied', 'failed')),
  template text not null default 'classic',
  tailored_resume jsonb,
  pdf_path text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  applied_at timestamptz,
  -- One application per job (Add to Applications is idempotent / upserts by job).
  unique (job_id)
);

create index if not exists applications_status_idx on applications (status);
create index if not exists applications_created_at_idx on applications (created_at desc);

-- Private bucket for generated résumé PDFs (the app serves signed URLs).
insert into storage.buckets (id, name, public)
values ('resumes', 'resumes', false)
on conflict (id) do nothing;
