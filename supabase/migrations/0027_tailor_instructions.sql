-- 0027_tailor_instructions.sql
-- Per-application custom tailoring instructions (ADR 0037). Free-text guidance the user
-- gives the AI when generating the tailored résumé — typically a recruiter's ask relayed
-- by the user ("emphasize Angular over React", "lead with the payments project"). The
-- worker folds this into the tailoring prompt ON TOP OF the job description, subordinate
-- to the existing truthfulness rules (emphasis/ordering only — never fabrication).
alter table applications add column if not exists tailor_instructions text;
