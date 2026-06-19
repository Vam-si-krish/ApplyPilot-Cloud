-- Per-location fetch limits (ADR 0015). Until now a single results_per_query
-- applied to every keyword × location equally. This adds an optional per-location
-- override: a JSON map of { "<location>": <jobs per role> }. A location absent
-- from the map falls back to results_per_query. LinkedIn fans out one Apify run
-- per location so each can carry its own cap.
-- Run in the Supabase SQL editor, or via `supabase db push`.

alter table settings add column if not exists location_limits jsonb not null default '{}'::jsonb;
