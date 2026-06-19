# ADR 0021 — Segregate applications: Easy Apply vs company/ATS portal

**Status:** accepted · **Date:** 2026-06-18 · **Extends** [ADR 0012](0012-gmail-inbox.md)

## Context
The user wants to know, from the inbox confirmation emails, **how many applications went through LinkedIn
Easy Apply vs a real company/ATS portal** — tracked while the inbox AI is already classifying mail, and
stored.

**Research — how the emails differ (the signal is the sender):**
- **Easy Apply:** the confirmation comes from **linkedin.com** (`jobs-noreply@linkedin.com`), subject
  "Your application was sent to …". The application lives on LinkedIn.
- **Company portal / ATS:** comes from the company's own domain (careers@/talent@) or an applicant
  tracking system — Greenhouse (`greenhouse.io`), Lever (`lever.co`), Workday (`myworkday.com`), Ashby
  (`ashbyhq.com`), iCIMS, Workable, SmartRecruiters, Taleo (`taleo.net`), Jobvite, BambooHR, … Subject
  "Thank you for applying / We received your application."

## Decision
Add `apply_source ∈ {easy_apply, company_portal}` to classified mail, set by the **same** inbox LLM call.

- **Schema (migration 0016):** `mail_messages.apply_source text` (nullable, checked). Backfills existing
  `applied` rows from the sender domain (`%linkedin.com` → easy_apply, else company_portal).
- **Classifier (`lib/mailClassify.ts`):** the prompt now also returns a `SOURCE:` line
  (easy_apply | company_portal | none), judged mainly by the sender (the prompt lists the ATS domains).
  Parsed into `apply_source`. A code safety-net forces `easy_apply` for an `applied` mail from
  linkedin.com (unambiguous). Still one LLM call per email; the frozen SCORE_PROMPT is untouched.
- **Surfaced:** `GET /api/mail` and `/api/mail/stats` return an `applySources` split
  (easy_apply / company_portal / unknown). The **Inbox** shows an "Applied via" breakdown + a per-message
  Easy Apply / Portal tag; the **Tracker** shows the same split under Pipeline.

## Consequences
- The user sees the Easy-Apply-vs-portal split for free (no extra call), in both the Inbox and Tracker.
- `apply_source` is only meaningful for `applied` mail; null elsewhere. Old mail is backfilled
  deterministically; new mail is AI-labeled (with the linkedin.com safety-net).

## Alternatives considered
- **Pure domain rule (no AI)** — reliable for LinkedIn, but ATS detection benefits from the model
  recognizing company-owned domains and odd ATS senders. Kept AI-driven per project preference, with the
  linkedin.com rule only as a safety-net.
- **A separate mail category** — rejected: source is orthogonal to the applied/shortlisted/… category, so
  it's a separate field, not a 7th category.
