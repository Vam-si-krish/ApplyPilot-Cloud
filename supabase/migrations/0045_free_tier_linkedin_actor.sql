-- New accounts inherited Bebity's LinkedIn actor, which now requires a
-- $29.99/month rental before usage. Use the supported pay-per-result actor for
-- non-owner fixed accounts and for all future settings rows (ADR 0076).

alter table public.settings
  alter column apify_actor_id set default 'cheap_scraper~linkedin-job-scraper';

update public.settings
set
  apify_actor_id = 'cheap_scraper~linkedin-job-scraper',
  updated_at = now()
where user_id in (
    '00000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000003'
  )
  and apify_actor_id = 'bebity~linkedin-jobs-scraper';

-- Re-check these keys on the next run. A genuinely exhausted account will be
-- parked again by the normal credit probe; an actor-rental failure should not
-- leave a user stuck behind a stale cooldown.
update public.api_keys
set cooldown_until = null
where provider = 'apify'
  and user_id in (
    '00000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000003'
  );
