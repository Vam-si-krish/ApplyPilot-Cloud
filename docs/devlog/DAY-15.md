# DAY 15 — 2026-07-14 (fixed-account multi-user foundation)

## Product decision

The first multi-user release uses three fixed username/password accounts. Public signup
and password reset are deferred. ADR 0073 records the security boundary and the owner's
permission to use the server subscription only for résumé onboarding.

## Implementation

- Added identity-bearing HMAC sessions and username/password login from server-only
  `APP_USERS_JSON`; middleware overwrites trusted user headers from the signed cookie.
- Migration 0044 adds three account identities and `user_id` ownership to every domain
  table, converts singleton primary keys to per-user keys, makes unique values per-user,
  adds composite foreign keys, and forces RLS on ten tables.
- The gateway issues five-minute user/service PostgREST JWTs and physically namespaces
  storage by user UUID. Signed downloads retain the namespace without exposing it in the
  logical object path.
- Next server data clients and worker clients carry user context. Background scoring,
  Apify callbacks, Gmail jobs, and queue continuations resolve/carry an explicit user.
- Deployment-level Apify/LLM fallback is disabled for the fork. Each account's vault keys
  drive normal operation; non-owner accounts cannot select the owner's subscription for
  scoring/chat/tailoring.
- Added `/onboarding`: upload a text-based PDF (10 MB max), extract text, perform one
  subscription-backed faithful parse, store the PDF privately, and derive structured
  résumé, profile, skills, role/location suggestions, and Assistant grounding.

## Verification

- All 45 legacy migrations plus migration 0044 apply to a fresh temporary database;
  three profiles and all ten forced-RLS tables were present.
- Live migration applied after a backup. Public Funnel probes proved two users can store
  the same job URL/file path independently and cannot read a known row ID across users.
- Wrong credentials returned 401; all three logins produced the expected identity and
  account-specific onboarding row.
- A synthetic PDF completed the real subscription parse and initialized the selected
  account. The synthetic row/file/profile data was then removed and the account reset.
- Backend 2/2, worker 3/3, app 172 tests (8 live evals skipped), typecheck, and the 33-page
  production build pass on the server laptop.

## Remaining deployment step

Add `APP_USERS_JSON` and the other fork variables to the separate Netlify site, deploy,
then set the actual site URL in `NEXT_PUBLIC_APP_URL` and backend `CORS_ORIGINS`. Public
signup is still intentionally unavailable.
