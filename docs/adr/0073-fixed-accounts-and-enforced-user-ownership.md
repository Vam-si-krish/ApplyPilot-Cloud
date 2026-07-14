# ADR 0073 — Fixed accounts with enforced per-user ownership

**Status:** accepted · **Date:** 2026-07-14 · **Builds on:** ADR 0072

> **Amended by ADR 0074:** after onboarding, a user may use either their own API keys or
> their own UUID-isolated Claude subscription connection. The owner's subscription
> remains restricted to bounded onboarding.

## Context

The isolated Phase 1 backend is live. The next milestone is private use by three known
people. Public self-service signup is intentionally deferred, but the data model cannot
remain single-user: every résumé, profile, setting, API key, job, run, message,
application, generated file, and worker action must belong to exactly one account.

The owner permits the onboarding parser to use the server laptop's authenticated AI
subscription. That permission is limited to turning the uploaded résumé into the initial
profile/search configuration. Scraping, scoring, chat, and tailoring after onboarding use
the logged-in user's own saved API keys and selected providers.

## Decision

### Identity

- Configure exactly three accounts in Netlify's server-only `APP_USERS_JSON` value.
- Each entry has a stable UUID, username, and password. No signup or password-reset route
  is exposed in this milestone.
- The signed session contains the account UUID and username. Middleware discards any
  caller-supplied identity header and injects the verified UUID into the server request.
- A later account system may replace the fixed credential source while preserving UUIDs
  and the ownership schema.

### Enforcement

- Add `user_id` to every domain table. Existing Phase 1 rows become the owner's rows;
  each fixed account receives its own profile/settings/scoring/Gmail singleton rows.
- PostgreSQL row-level security is enabled and forced. The gateway converts the trusted
  identity header into a short-lived, server-signed PostgREST JWT. User-scoped requests
  can read/write only matching rows; explicit service scope is reserved for authenticated
  cross-user orchestration such as resolving an Apify callback to its owning run.
- Uniqueness becomes per-user (`jobs.url`, active provider key, Gmail message ID).
  Composite foreign keys prevent relationships crossing account boundaries.
- Storage is namespaced under the account UUID by the gateway. Signed download tokens
  carry the namespace, so knowing another account's logical object path is insufficient.
- The résumé worker resolves the owning application and then uses a user-scoped database
  and storage client for every subsequent operation.

### Onboarding

- First login leads to résumé onboarding. The user uploads a PDF; the server extracts its
  text and sends that text through the owner's subscription worker for one faithful,
  anti-fabrication parse.
- Persist the original PDF, normalized structured résumé, scoring résumé text, profile
  facts, skill list, initial role/location search suggestions, and onboarding completion.
- The shared subscription is not selected as the user's normal scoring/tailoring model.
  The UI directs the user to add their own Apify and LLM keys before starting a run.

## Consequences

- A bug that omits a query filter is contained by forced RLS rather than becoming a data
  leak. The Netlify service key remains sensitive, but it cannot make a user-scoped JWT
  access a different UUID.
- Cron and webhook chains must carry or resolve a user UUID at every continuation.
- The three passwords remain deployment secrets and are never committed. Adding a fourth
  person requires both a configured identity and a provisioned singleton set until the
  later signup system is implemented.

## Verification gates

1. Each account can log in; a wrong username/password fails without identifying which
   field was wrong.
2. User A cannot read, update, delete, join, or sign storage belonging to User B, including
   when object IDs/paths are known.
3. The same job URL, provider, and Gmail ID can exist independently for all three users.
4. PDF onboarding creates only the logged-in user's profile/settings/files and marks only
   that account complete.
5. User-owned Apify/LLM keys or the user's own UUID-isolated Claude connection drive
   normal work; onboarding alone may use the owner's shared subscription.
6. Fresh migration, backend/worker/app tests, typecheck, production build, live migration,
   public health, recovery, and backup all pass.
