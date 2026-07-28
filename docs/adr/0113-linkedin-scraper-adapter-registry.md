# ADR 0113: Actor-scoped LinkedIn scraper adapters

- Status: accepted
- Date: 2026-07-28
- Amends [ADR 0005](0005-configurable-apify-actor.md) and
  [ADR 0110](0110-linkedin-keyword-mode-fetch.md)

## Context

`settings.apify_actor_id` was configurable, but LinkedIn input was not: every selected
actor received `cheap_scraper`'s keyword/locations schema. An actor ID change could
therefore start a paid run with an incompatible payload. Pricing was likewise keyed only
by the portal, and webhook output mapping had no knowledge of the actor that produced
the dataset.

The `curious_coder~linkedin-jobs-scraper` actor has a different contract. It takes one
or more full LinkedIn Jobs search URLs and derives LinkedIn's filters from those URLs.
It returns detailed job data with a salary array and an actor-specific apply-method
shape. Its pay-per-result price also differs from the existing default.

## Decision

- LinkedIn actor behavior is registered as an adapter: actor ID, input mode and builder,
  result cap, price per result, and optional dataset-item normalizer.
- Run plans carry their own result estimate and unit price. The Apify credit preflight
  sums those actor-specific values rather than assuming one LinkedIn price.
- Webhook URLs carry the normalized actor ID in addition to the portal. The signed
  callback uses it to select output normalization; callbacks created before this change
  retain generic mapping.
- `cheap_scraper` remains the default and retains ADR 0110's criteria/keyword strategy.
- `curious_coder` is an explicit Settings choice. It reads up to 20 persisted,
  de-duplicated HTTPS LinkedIn Jobs search URLs, sends them as `urls`, and applies the
  configured hard cap as `count` (minimum 10). Optional actor execution flags are
  omitted so the actor's maintained defaults control pagination behavior.
- Search URLs must use a real `linkedin.com` host and the `/jobs/search` or
  `/jobs/search-results` path. Job-detail URLs and lookalike hosts are rejected before
  persistence.
- Unknown saved custom actors retain the legacy criteria-compatible input as a backward
  compatibility path, with a conservative cost estimate. New integrations must be
  registered explicitly instead of relying on that fallback.

## Consequences

- ADR 0110's keyword-only rule now applies specifically to the `cheap_scraper` adapter,
  not every LinkedIn actor.
- A user can construct a search in LinkedIn, including recency, experience, job type,
  workplace, salary, Easy Apply, or applicant-count facets, save its full URL once, and
  reuse it in scheduled runs.
- Adding a future scraper is bounded to one adapter implementation plus its safe Settings
  descriptor and regression fixture; portal orchestration, webhook routing, and cost
  guarding do not need actor-specific branches.
- Existing accounts and schedules do not change actor automatically. Selecting the new
  actor can incur Apify charges, so no live actor run is part of implementation
  verification.
- In URL mode, Settings hides the inactive role, location, lookback, and per-role
  controls when no other criteria-driven portal is enabled. It keeps local
  skills/prefilter controls and shows the exact `count` planned for the next run beside
  the saved URLs.
