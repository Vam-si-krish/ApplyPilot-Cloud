-- Add easy_apply to jobs: LinkedIn "Easy Apply" vs. full external application.
-- Null = unknown (non-LinkedIn portals or older rows before this migration).
alter table jobs add column if not exists easy_apply boolean;

-- Add job_portals to settings: which portals to search (linkedin / indeed / glassdoor).
alter table settings add column if not exists job_portals text[] not null default array['linkedin']::text[];
