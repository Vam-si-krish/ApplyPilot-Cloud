# ADR 0003 — Single shared-password auth
**Status:** accepted · **Date:** 2026-06-17
## Context
The app is single-user and exposes the owner's resume + personal data, so it must not be
publicly readable. The brief offered Supabase magic-link or a single shared password.
## Decision
A single shared password (`APP_PASSWORD`). The login route sets a signed, httpOnly session
cookie (HMAC with `AUTH_SECRET`); `middleware.ts` rejects any request without a valid cookie
(except the login page, its POST, and static assets). No user table, no email provider.
## Alternatives considered
- **Supabase Auth magic-link** — rejected for now: needs an email provider + Auth config for
  a single user; more moving parts than the threat model warrants. Can be revisited if
  multi-user is ever wanted.
- **HTTP Basic Auth at the edge** — rejected: weaker UX, no clean logout, credentials re-sent
  every request.
## Notes
Because data is gated at the app layer (service-role key, server-side), Supabase RLS is not
the primary gate. If the anon key is ever used client-side for reads, add RLS before relying on it.
