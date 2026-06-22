-- What the AI added/embellished beyond the base résumé (ADR 0026), so the user can
-- review and confirm before using the tailored résumé. { addedSkills: [], notes: [] }.
alter table applications add column if not exists tailor_changes jsonb;
