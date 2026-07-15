-- Phase 1 supervised application-assistant queue (ADR 0093).
--
-- This state is deliberately orthogonal to applications.status: tailoring can remain
-- ready while the supervised browser workflow moves through assignment, form filling,
-- review, blocking, and verified submission.
alter table public.applications
  add column if not exists ai_apply_status text,
  add column if not exists ai_assigned_at timestamptz,
  add column if not exists ai_apply_updated_at timestamptz,
  add column if not exists ai_block_reason text;

alter table public.applications
  drop constraint if exists applications_ai_apply_status_check;

alter table public.applications
  add constraint applications_ai_apply_status_check
  check (
    ai_apply_status is null or ai_apply_status in (
      'assigned',
      'in_progress',
      'ready_to_submit',
      'blocked',
      'submitted'
    )
  );

alter table public.applications
  drop constraint if exists applications_ai_apply_parking_check;

alter table public.applications
  add constraint applications_ai_apply_parking_check
  check (
    ai_apply_status is null
    or (ai_apply_status = 'blocked' and parked)
    or (ai_apply_status <> 'blocked' and not parked)
  );

alter table public.applications
  drop constraint if exists applications_ai_block_reason_length_check;

alter table public.applications
  add constraint applications_ai_block_reason_length_check
  check (ai_block_reason is null or char_length(ai_block_reason) <= 500);

create index if not exists applications_user_ai_apply_idx
  on public.applications (user_id, ai_apply_status, ai_assigned_at);

notify pgrst, 'reload schema';
