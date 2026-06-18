-- Gmail "AI inbox" (ADR 0012). Connect a Gmail account; the pipeline classifies
-- incoming job-related mail into categories and tracks a per-day history.
-- Google OAuth credentials are entered in the Settings UI (vault-style), stored
-- here, and reachable only via the service-role key.
-- Run this in the Supabase SQL editor, or via `supabase db push`.

-- Single-row connection: the user's Google OAuth app + the authorized account.
create table if not exists gmail_connection (
  id             int primary key default 1 check (id = 1),
  client_id      text,
  client_secret  text,
  refresh_token  text,        -- obtained via OAuth; null until connected
  email          text,        -- the connected Gmail address
  last_synced_at timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
insert into gmail_connection (id) values (1) on conflict (id) do nothing;

-- One row per classified email.
create table if not exists mail_messages (
  id          uuid primary key default gen_random_uuid(),
  gmail_id    text not null unique,   -- Gmail message id (de-dupe key)
  thread_id   text,
  received_at timestamptz,
  from_email  text,
  from_name   text,
  subject     text,
  snippet     text,
  category    text not null default 'other'
                check (category in ('applied','shortlisted','action_needed','assessment','rejection','other')),
  summary     text,
  created_at  timestamptz not null default now()
);
create index if not exists mail_messages_received_idx on mail_messages (received_at desc);
create index if not exists mail_messages_category_idx on mail_messages (category);
