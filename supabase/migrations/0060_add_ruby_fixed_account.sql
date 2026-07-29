-- Add the owner-authorized fifth fixed production account without changing existing
-- UUID ownership. The password remains only in Netlify APP_USERS_JSON (ADR 0115).

insert into public.app_users (id, username, display_name) values
  ('e434e565-6be0-4c9e-b396-0f2323cf6045', 'ruby', 'Ruby')
on conflict (id) do update set
  username = excluded.username,
  display_name = excluded.display_name,
  updated_at = now();

insert into public.profile (id, user_id) values
  (1, 'e434e565-6be0-4c9e-b396-0f2323cf6045')
on conflict (user_id) do nothing;

insert into public.settings (id, user_id, auto_scrape_enabled) values
  (1, 'e434e565-6be0-4c9e-b396-0f2323cf6045', false)
on conflict (user_id) do nothing;

insert into public.gmail_connection (id, user_id) values
  (1, 'e434e565-6be0-4c9e-b396-0f2323cf6045')
on conflict (user_id) do nothing;

insert into public.scoring_state (id, user_id) values
  (1, 'e434e565-6be0-4c9e-b396-0f2323cf6045')
on conflict (user_id) do nothing;
