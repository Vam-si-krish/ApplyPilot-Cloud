-- Add the owner-authorized fourth fixed production account without changing existing
-- UUID ownership. The password remains only in Netlify APP_USERS_JSON (ADR 0103).

insert into public.app_users (id, username, display_name) values
  ('578fcb56-5900-4d0d-be20-6b6c191554b7', 'rishab', 'Rishab')
on conflict (id) do update set
  username = excluded.username,
  display_name = excluded.display_name,
  updated_at = now();

insert into public.profile (id, user_id) values
  (1, '578fcb56-5900-4d0d-be20-6b6c191554b7')
on conflict (user_id) do nothing;

insert into public.settings (id, user_id, auto_scrape_enabled) values
  (1, '578fcb56-5900-4d0d-be20-6b6c191554b7', false)
on conflict (user_id) do nothing;

insert into public.gmail_connection (id, user_id) values
  (1, '578fcb56-5900-4d0d-be20-6b6c191554b7')
on conflict (user_id) do nothing;

insert into public.scoring_state (id, user_id) values
  (1, '578fcb56-5900-4d0d-be20-6b6c191554b7')
on conflict (user_id) do nothing;
