-- Opt-in AI Apply UI plus assessment calendar metadata extracted from Gmail.
-- Email bodies remain transient and are never stored; only grounded event dates persist.

alter table public.settings
  add column if not exists ai_apply_enabled boolean not null default false;

alter table public.mail_messages
  add column if not exists assessment_start_at timestamptz,
  add column if not exists assessment_end_at timestamptz;

alter table public.mail_messages
  drop constraint if exists mail_messages_assessment_dates_ordered,
  add constraint mail_messages_assessment_dates_ordered
    check (
      assessment_start_at is null
      or assessment_end_at is null
      or assessment_end_at >= assessment_start_at
    );

create index if not exists mail_messages_assessment_calendar_idx
  on public.mail_messages (user_id, assessment_start_at, assessment_end_at)
  where category = 'assessment'
    and (assessment_start_at is not null or assessment_end_at is not null);
