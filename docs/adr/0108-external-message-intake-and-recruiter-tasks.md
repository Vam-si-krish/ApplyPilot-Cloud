# ADR 0108: External message intake and recruiter reply tasks

- Status: accepted
- Date: 2026-07-19
- Amends: ADR 0105 mail calendar interviews and week view; ADR 0106 calendar task completion

## Context

Interviews and recruiter opportunities may arrive by phone/SMS, chat, or an email account
that is not connected to ApplyPilot. Gmail-derived calendar events cannot represent those
messages. Recruiter outreach already has a high-priority classifier category, but it is
visible only in Inbox and therefore does not answer the actionable question “did I reply?”

## Decision

- Calendar exposes a signed-in `POST /api/calendar/intake` path for up to 30,000 pasted
  characters. It uses the existing per-user scoring/classification provider and browser
  timezone to extract only explicitly supported company, role, summary, and timestamps.
- Raw pasted content is transient request/model input and is never persisted. Accepted
  extraction reuses the forced-RLS `mail_messages` owner boundary with a synthetic
  `manual:<uuid>` de-duplication key and `intake_source='manual'` provenance.
- Only a confirmed dated interview/assessment or genuine recruiter outreach creates a
  row. Unrelated, uncertain, and completion-only pasted text fails visibly with no write.
- Recruiter-category rows from both Gmail and manual intake appear as reply tasks in the
  reversible Active/Done ledger. Undated recruiter tasks never render on the date grid;
  a recruiter message with an explicitly confirmed call may also produce an interview.
- `company_name` and `role_title` are grounded optional classification fields for future
  Gmail and manual rows. Existing rows remain valid with null values.

## Consequences

External job-search messages participate in the same checklist and ownership controls as
connected mail without persisting potentially sensitive raw correspondence. The design
does not create or mark an ApplyPilot job as applied because pasted outreach does not
prove an application submission or identify a unique jobs row. The user instead marks the
interview/reply task done; application state continues to require its existing evidence.
