-- Durable, user-owned calendar task completion with explicit provenance.
alter table public.mail_messages
  add column if not exists calendar_completed_at timestamptz,
  add column if not exists calendar_completion_source text;

alter table public.mail_messages
  drop constraint if exists mail_messages_calendar_completion_source_check,
  add constraint mail_messages_calendar_completion_source_check
    check (calendar_completion_source is null or calendar_completion_source in ('user', 'email'));

create index if not exists mail_messages_calendar_active_idx
  on public.mail_messages (user_id, calendar_end_at, calendar_start_at)
  where calendar_event_kind is not null and calendar_completed_at is null;
