# ADR 0105: Mail calendar interviews and week view

- Status: accepted
- Date: 2026-07-17
- Amends: ADR 0104 opt-in AI Apply and assessment calendar

## Context

Assessment-only dates do not cover scheduled interviews, and a month grid alone is not
enough to understand a busy near-term week. Gmail snippets and short body excerpts can
also omit dates carried later in an invitation or quoted scheduling confirmation.

## Decision

- Generalize persisted mail calendar metadata to `calendar_event_kind`,
  `calendar_start_at`, and `calendar_end_at`. Event kind is assessment or interview.
- An assessment may have an opening time, deadline, or both. A lone assessment deadline
  is stored as the end. A scheduled interview requires an explicit date/time; an email
  asking the candidate to choose availability does not create an event yet.
- Send up to 30,000 normalized body characters plus a 3,000-character snippet, received
  timestamp, and user timezone to the per-user mail classifier. The body remains
  transient and is never persisted.
- Show month and week views, render multi-day assessment windows on every included day,
  distinguish interviews from assessments, and call out due-soon and overdue items.

## Consequences

Calendar coverage and readability improve at the cost of larger per-message model input.
Dates remain conservative: uncertain or reversed ranges are discarded. Existing dated
assessment columns remain for compatibility and are backfilled into the generalized
event fields by migration 0055.
