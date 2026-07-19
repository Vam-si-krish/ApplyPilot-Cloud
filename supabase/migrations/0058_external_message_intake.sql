-- Pasted external interview/recruiter messages reuse the user-owned mail task model.
-- The raw pasted body is transient; only grounded extraction and source provenance persist.
alter table public.mail_messages
  add column if not exists intake_source text not null default 'gmail',
  add column if not exists company_name text,
  add column if not exists role_title text;

alter table public.mail_messages
  drop constraint if exists mail_messages_intake_source_check,
  add constraint mail_messages_intake_source_check
    check (intake_source in ('gmail', 'manual'));

create index if not exists mail_messages_recruiter_tasks_idx
  on public.mail_messages (user_id, received_at desc)
  where category = 'recruiter';
