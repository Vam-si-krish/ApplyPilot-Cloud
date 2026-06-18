-- Decouple Gmail fetch from AI classification (ADR 0013).
-- The old single-pass sync fetched + classified in one shot and capped each run,
-- then advanced last_synced_at to now() — silently dropping any backlog beyond
-- the cap. Now a message is first stored as 'pending' (headers + snippet, no
-- category yet); a separate classify pass sets the AI category and flips it to
-- 'classified'. last_synced_at only advances once the whole look-back window has
-- been fetched, so no mail is ever skipped.
-- Run in the Supabase SQL editor, or via `supabase db push`.

-- A pending message has no category until the AI labels it.
alter table mail_messages alter column category drop not null;
alter table mail_messages alter column category drop default;

-- Lifecycle flag: 'pending' (fetched, awaiting AI) → 'classified'.
alter table mail_messages add column if not exists status text not null default 'pending'
  check (status in ('pending', 'classified'));

-- Everything already stored was classified by the old single-pass sync.
update mail_messages set status = 'classified' where category is not null;

create index if not exists mail_messages_status_idx on mail_messages (status);
