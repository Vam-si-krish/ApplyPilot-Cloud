-- Generalize dated mail from assessment-only fields to assessment + interview events.
alter table public.mail_messages
  add column if not exists calendar_event_kind text,
  add column if not exists calendar_start_at timestamptz,
  add column if not exists calendar_end_at timestamptz;

alter table public.mail_messages
  drop constraint if exists mail_messages_calendar_event_kind_check,
  add constraint mail_messages_calendar_event_kind_check
    check (calendar_event_kind is null or calendar_event_kind in ('assessment', 'interview')),
  drop constraint if exists mail_messages_calendar_dates_ordered,
  add constraint mail_messages_calendar_dates_ordered
    check (
      calendar_start_at is null
      or calendar_end_at is null
      or calendar_end_at >= calendar_start_at
    );

update public.mail_messages
set calendar_event_kind = 'assessment',
    calendar_start_at = assessment_start_at,
    calendar_end_at = assessment_end_at
where category = 'assessment'
  and (assessment_start_at is not null or assessment_end_at is not null)
  and calendar_event_kind is null;

create index if not exists mail_messages_calendar_events_idx
  on public.mail_messages (user_id, calendar_start_at, calendar_end_at)
  where calendar_event_kind is not null;
