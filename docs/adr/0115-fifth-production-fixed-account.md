# ADR 0115: Fifth production fixed account

- Status: accepted
- Date: 2026-07-29
- Amends: ADRs 0073 and 0103

## Context

The owner requested a fifth production user, Ruby, with the explicit six-character
initial password supplied out of band. Phase 2A otherwise requires fixed-account
passwords to contain at least ten characters. An environment-only addition would fail
the identity allowlist and would not provision the singleton rows required by forced
RLS.

## Decision

- Provision stable UUID `e434e565-6be0-4c9e-b396-0f2323cf6045` for username `ruby` and
  display name `Ruby` in production migration 0060.
- Create empty, user-owned Profile, Settings, Gmail, and scoring singleton rows. Keep
  automatic scraping disabled until Ruby completes onboarding and configuration.
- Accept the three baseline identities plus either or both provisioned optional
  identities. An optional account may never replace a baseline account.
- Preserve the ten-character password minimum for every account except Ruby. Ruby alone
  receives an owner-authorized minimum of six characters so the requested initial
  credential can be configured.
- Store Ruby's password only in Netlify's secret production `APP_USERS_JSON`. Do not
  commit, log, or copy it into development.
- This remains a fixed private account. It does not add signup, recovery, or a general
  account-management surface.

## Consequences

- Ruby receives a clean onboarding experience behind the existing signed-session,
  forced-RLS, UUID-scoped storage, and worker boundaries.
- The short password is materially weaker, while the public login endpoint still lacks
  the abuse controls deferred to Phase 2B. The exception is intentionally UUID-specific
  and does not lower the policy for another account.
- Development can remain on the three baseline identities.

## Verification

- Cover five-account authentication, wrong-password rejection, the Ruby-only minimum,
  baseline retention, and rejection of unknown UUIDs.
- Back up production, apply migration 0060, and verify every singleton row is owned by
  Ruby's UUID.
- Update only the production Netlify secret, deploy, verify Ruby login/onboarding, and
  recheck cross-user denial and public service health.
