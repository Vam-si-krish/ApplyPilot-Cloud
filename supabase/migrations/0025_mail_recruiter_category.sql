-- 0025_mail_recruiter_category.sql
-- Add a 'recruiter' mail category: inbound recruiter/sourcer outreach about a NEW
-- opportunity the user did NOT apply to (e.g. "I have a role, are you interested,
-- send me your resume"). The original taxonomy (ADR 0012) only covered replies to
-- applications the user already submitted, so cold recruiter outreach fell through
-- to 'other' and got hidden — even though, for an active job-seeker, it's one of the
-- most important things in the inbox. Widen the CHECK constraint to allow it.
alter table mail_messages drop constraint if exists mail_messages_category_check;
alter table mail_messages add constraint mail_messages_category_check
  check (category in ('recruiter','applied','shortlisted','action_needed','assessment','rejection','other'));
