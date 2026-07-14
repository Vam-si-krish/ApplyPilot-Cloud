-- Webhook ingestion must use the same user-owned Apify account that launched the
-- run. The active key can change while an actor is running (manual activation or
-- round-robin rotation), and datasets are private to their owning Apify account.

alter table public.runs add column if not exists apify_api_key_id uuid;

alter table public.api_keys drop constraint if exists api_keys_user_id_id_key;
alter table public.api_keys add constraint api_keys_user_id_id_key unique (user_id, id);

alter table public.runs drop constraint if exists runs_apify_api_key_user_fkey;
alter table public.runs add constraint runs_apify_api_key_user_fkey
  foreign key (user_id, apify_api_key_id)
  references public.api_keys(user_id, id)
  on delete set null (apify_api_key_id);
