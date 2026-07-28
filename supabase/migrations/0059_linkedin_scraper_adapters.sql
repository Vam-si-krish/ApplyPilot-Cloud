-- Actor-scoped LinkedIn scraper adapters (ADR 0113).
--
-- URL-driven actors reuse full LinkedIn Jobs search URLs so every LinkedIn filter
-- remains in-search. Existing accounts stay on their current actor until the user
-- explicitly selects a different adapter in Settings.
alter table public.settings
  add column if not exists linkedin_search_urls text[] not null default '{}';
