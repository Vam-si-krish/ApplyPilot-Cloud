-- Rich profile blob for the Assistant (ADR 0011). Holds the complete applicant
-- facts — job preferences, availability, EEO, full work history, education, résumé
-- metrics — beyond the five structured columns, so the chat assistant can answer
-- anything. The structured columns still override their overlapping sections, so
-- the Profile page stays the editable source of truth for those.
-- Run this in the Supabase SQL editor, or via `supabase db push`.

alter table profile add column if not exists assistant_profile jsonb not null default '{}'::jsonb;
