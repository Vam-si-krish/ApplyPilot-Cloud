# ADR 0103: Fourth production fixed account

- Status: accepted
- Date: 2026-07-16
- Amends: ADR 0073

## Context

Phase 2A originally constrained `APP_USERS_JSON` to exactly three identities whose stable
UUIDs were provisioned by migration 0044. The owner requested a fourth production user,
Rishab, without replacing any existing account and without adding the account to the
isolated development environment.

An environment-only addition would fail authentication validation and would lack the
`app_users`, Profile, Settings, Gmail, and scoring singleton rows required by forced RLS.
Updating the application before the secret must also remain safe for the existing
three-account production configuration during the Netlify deployment window.

## Decision

- Provision stable UUID `578fcb56-5900-4d0d-be20-6b6c191554b7` for username `rishab`
  and display name `Rishab` in production migration 0053.
- Create empty, user-owned Profile, Settings, Gmail, and scoring singleton rows; keep
  automatic scraping disabled until the user completes onboarding and configuration.
- Accept either the three baseline identities or those same three plus Rishab. Never
  accept an unknown UUID or allow the optional identity to replace a baseline account.
- Store Rishab's password only in Netlify's secret production `APP_USERS_JSON`. Do not
  commit, log, or copy it into development.
- Preserve public-signup and password-reset deferral; this is one owner-authorized fixed
  account, not a general account-creation system.

## Consequences

- Rishab receives a clean onboarding experience and cannot see another account's rows or
  files under the existing forced-RLS and UUID namespace boundaries.
- Development remains a three-account environment by default.
- The code can deploy before the production secret changes without invalidating existing
  sessions or login configuration.

## Verification

- Test three-account compatibility, four-account authentication, baseline retention, and
  rejection of unknown UUIDs.
- Apply migration 0053 after a production backup and verify all singleton rows are owned
  by the new UUID.
- Update only the production Netlify secret, deploy, verify Rishab login/onboarding, and
  recheck an existing production account plus cross-user denial.
