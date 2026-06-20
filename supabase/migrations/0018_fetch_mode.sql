-- Selectable fetch strategy (ADR 0023): two ways to drive the LinkedIn actor.
--  * url     — URL-driven: crawl exactly the role×location searches we build (precise,
--              predictable count). The default.
--  * keyword — actor-native: hand it keyword[] + locations[] and let it build one
--              search per pair (broader reach; count still bounded by maxItems).
-- Run in the Supabase SQL editor, or via `supabase db push`.

alter table settings add column if not exists fetch_mode text not null default 'url'
  check (fetch_mode in ('url', 'keyword'));
