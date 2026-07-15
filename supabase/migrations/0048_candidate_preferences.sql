-- One user-owned home for application answers and constrained AI guidance (ADR 0081).
-- Existing forced RLS on profile automatically protects this column with the row.
alter table public.profile
  add column if not exists candidate_preferences jsonb not null default '{}'::jsonb;
