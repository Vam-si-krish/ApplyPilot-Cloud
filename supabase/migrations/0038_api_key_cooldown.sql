-- Apify key credit cooldown (ADR 0059). When a run-start probe finds a key's
-- remaining monthly credit below the estimated cost of one full fetch, the key is
-- parked until its usage cycle resets (the limits API's monthlyUsageCycle.endAt)
-- so rotation never lands on it and a run never dies mid-scrape. Null = eligible.
alter table api_keys add column if not exists cooldown_until timestamptz;
