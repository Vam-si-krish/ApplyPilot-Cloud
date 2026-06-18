# ADR 0012 — Gmail AI inbox (UI-managed OAuth, classified mail, daily history)
**Status:** accepted · **Date:** 2026-06-18
## Context
The user wants incoming job-related Gmail auto-triaged: connect Gmail, and on each new email an AI
decides what it is (application confirmation, shortlist/interview, action needed, assessment,
rejection, other) with a per-day count history. Crucially, the **Google OAuth credentials are entered
in the Settings UI** (vault-style), not env.
## Decision
- **Schema** (migration 0010): single-row `gmail_connection` (client_id, client_secret, refresh_token,
  email, last_synced_at) + `mail_messages` (gmail_id unique, headers, snippet, category, summary).
- **OAuth (no SDK)** — `lib/gmail.ts` does plain fetch against Google OAuth2 + Gmail REST. Read-only
  scope (`gmail.readonly` + `userinfo.email`). Routes: `POST /api/gmail/creds` (store client_id/secret
  from the UI), `GET /api/gmail/auth` (state cookie → consent), `GET /api/gmail/callback`
  (code→refresh_token, store + email), `POST /api/gmail/disconnect`. Redirect URI is shown in the UI
  to register in Google; it resolves to `${appBaseUrl()}/api/gmail/callback`.
- **Sync** — `POST/GET /api/gmail/sync` (cron + session, in middleware SELF_AUTH): lists messages since
  `last_synced_at` (`after:` query, default `newer_than:3d`), skips already-stored ids, fetches
  metadata + snippet, and classifies each via `lib/mailClassify.ts` — a **separate LLM call** (own
  prompt, frozen SCORE_PROMPT untouched) on the active vault key. Capped at 15/run; cron every 30 min.
- **UI** — Settings "Gmail Inbox" section (enter creds, see redirect URI + setup steps, Connect/
  Disconnect, status). New **Inbox** tab: category chips with counts, a per-day history table, and the
  classified message list (open-in-Gmail link). `GET /api/mail` returns messages + daily buckets.
## Security
Single-user, password-gated; client_secret + refresh_token live in a service-role-only table (same
posture as the API-key vault, ADR 0006). Read-only Gmail scope; an OAuth `state` cookie guards the
callback. The connect flow + callback are session-gated (the browser carries the session cookie).
## Alternatives considered
- **Gmail push (Pub/Sub) instead of polling** — rejected for now: more moving parts; a 30-min poll is
  plenty for job mail.
- **OAuth creds in env** — rejected: the user wants to manage them from the UI.
- **Fold classification into fit scoring** — rejected: separate concern, separate prompt/call.
## Notes
Needs a user-created Google Cloud OAuth app (External consent, test user = self) — only they can make
it. `prompt=consent` + `access_type=offline` ensure a refresh token. Bodies aren't downloaded (subject
+ snippet only), which keeps it light and privacy-conscious.
