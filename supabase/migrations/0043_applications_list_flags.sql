-- 0043: cheap existence flags for the Tailor & Apply list (perf).
--
-- The applications list endpoint shipped every row's full tailored_resume and
-- cover_letter (plus the joined job's full_description) just so the UI could ask
-- "does this row have a résumé yet?" — at ~650 applications that was an 11 MB
-- response on every page load and on every poll tick during bulk generation.
-- These generated columns let the list select stay slim (the heavy documents are
-- fetched per-row on expand); Postgres keeps them correct on every write for free.
alter table public.applications
  add column if not exists has_resume boolean
    generated always as (tailored_resume is not null) stored,
  add column if not exists has_cover_letter boolean
    generated always as (cover_letter is not null) stored;

-- PostgREST caches the schema; tell it to pick up the new columns.
notify pgrst, 'reload schema';
