-- Segregate application confirmations by how they were submitted (ADR 0021):
--  * easy_apply     — LinkedIn "Easy Apply" (confirmation comes from linkedin.com)
--  * company_portal — the company directly or an ATS (Greenhouse/Lever/Workday/…)
-- The inbox AI sets this when it classifies a mail as 'applied'. This backfills
-- existing 'applied' mail from the sender domain so the counts aren't empty.
-- Run in the Supabase SQL editor, or via `supabase db push`.

alter table mail_messages add column if not exists apply_source text
  check (apply_source in ('easy_apply', 'company_portal'));

-- Backfill: LinkedIn sender → easy_apply; any other applied confirmation → company_portal.
update mail_messages
   set apply_source = case
     when from_email ilike '%linkedin.com' then 'easy_apply'
     else 'company_portal'
   end
 where category = 'applied' and apply_source is null;

create index if not exists mail_messages_apply_source_idx on mail_messages (apply_source);
