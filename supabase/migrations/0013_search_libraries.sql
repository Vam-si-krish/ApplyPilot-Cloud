-- Saved search libraries (ADR 0016). Instead of typing/removing roles and
-- locations every time, keep a persistent library of options and let the user
-- *select* which to search. `keywords`/`locations` remain the ACTIVE selection
-- used by the run; `keyword_options`/`location_options` are the full saved lists.
-- Run in the Supabase SQL editor, or via `supabase db push`.

alter table settings add column if not exists keyword_options  text[] not null default '{}'::text[];
alter table settings add column if not exists location_options text[] not null default '{}'::text[];

-- Seed the libraries from whatever is currently selected, so nothing is lost.
update settings
   set keyword_options = keywords
 where coalesce(array_length(keyword_options, 1), 0) = 0
   and coalesce(array_length(keywords, 1), 0) > 0;

update settings
   set location_options = locations
 where coalesce(array_length(location_options, 1), 0) = 0
   and coalesce(array_length(locations, 1), 0) > 0;
