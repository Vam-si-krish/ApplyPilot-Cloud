-- Rename the two pilot identities without changing their stable UUID ownership.
-- Passwords remain deployment-only in Netlify APP_USERS_JSON (ADR 0073).

update public.app_users
set username = 'surya',
    display_name = 'Surya',
    updated_at = now()
where id = '00000000-0000-4000-8000-000000000002';

update public.app_users
set username = 'samitha',
    display_name = 'Samitha',
    updated_at = now()
where id = '00000000-0000-4000-8000-000000000003';
