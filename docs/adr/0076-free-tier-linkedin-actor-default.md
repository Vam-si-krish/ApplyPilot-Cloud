# ADR 0076 — Default new accounts to the pay-per-result LinkedIn actor

**Status:** accepted · **Date:** 2026-07-14 · **Amends:** ADR 0005 · **Relates to:**
ADR 0058/0059 (spend guards), ADR 0073 (per-user API keys)

## Context

The two new fixed accounts completed onboarding, saved their own Apify keys, and then
could not start their first fetch. Their settings rows inherited the schema default
`bebity~linkedin-jobs-scraper`. That actor currently requires a **$29.99/month rental plus
usage**, so an otherwise valid new/free Apify account is rejected before scraping.

The app already supports `cheap_scraper~linkedin-job-scraper` and its exact input shape.
Apify lists it as pay-per-result with a free-tier rate of **$0.70 per 1,000 results** and a
150-result minimum. Its `startUrls`, `maxItems`, `saveOnlyUniqueItems`, exclusions, and
keyword-match outputs are the behavior already pinned in `lib/apify.test.ts`.

References checked on 2026-07-14:

- [Bebity LinkedIn Jobs Scraper](https://apify.com/bebity/linkedin-jobs-scraper)
- [cheap_scraper LinkedIn Job Scraper](https://apify.com/cheap_scraper/linkedin-job-scraper)

## Decision

- Set the database default for `settings.apify_actor_id` to
  `cheap_scraper~linkedin-job-scraper`.
- Migrate only the two non-owner fixed accounts from Bebity to cheap_scraper when they
  still carry the inherited Bebity value. Do not change Vamsi's actor or overwrite any
  custom actor selected by a user.
- Clear those accounts' Apify-key cooldown once so the next run rechecks current credit.
  A genuinely exhausted key is immediately parked again by ADR 0059's normal probe.
- Put the pay-per-result actor first in Settings and label it recommended. Keep Bebity
  selectable, but label its monthly rental so users make an informed choice.

## Consequences

- New/free Apify accounts no longer require a separate actor rental for the default fetch.
- Fetching is not free: each person still pays Apify's per-result charge from their own
  account credits, and the 150-result minimum remains. The existing hard cap, cooldown,
  cost estimate, and key rotation continue to protect spend.
- Existing owner and custom actor choices are preserved.
- Actor pricing is external and mutable; labels and estimates must be rechecked against
  the Apify Store when this integration changes.

## Verification

1. Fresh settings rows default to cheap_scraper.
2. Pilot 2/3 inherited Bebity rows migrate; owner/custom rows do not.
3. Settings visibly distinguishes pay-per-result from paid rental.
4. A new user's own Apify key starts a 150-result-capped LinkedIn run and receives its
   webhook; a truly exhausted key still produces the credit guard.
