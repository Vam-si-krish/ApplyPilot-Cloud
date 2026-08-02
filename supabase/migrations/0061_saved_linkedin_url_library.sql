-- Saved/active LinkedIn URL library (ADR 0117).
--
-- Keep every validated search URL in the user's settings row while allowing an
-- independent active subset to drive the next URL-mode actor run. Existing active
-- URLs are copied into the library so deployment is lossless.
alter table public.settings
  add column if not exists linkedin_search_url_options text[] not null default '{}';

update public.settings
set linkedin_search_url_options = linkedin_search_urls
where cardinality(linkedin_search_url_options) = 0
  and cardinality(linkedin_search_urls) > 0;
