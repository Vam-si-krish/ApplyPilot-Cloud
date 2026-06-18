# ADR 0014 — Application Tracker (momentum view over classified mail)

**Status:** accepted · **Date:** 2026-06-18 · **Builds on** [ADR 0012](0012-gmail-inbox.md) / [0013](0013-gmail-two-phase-sync.md)

## Context
The AI already classifies incoming Gmail into job-search categories, including **applied**
(application-received confirmations). The user wants a dedicated place to see application volume over
time — "how many did I apply to today, two days ago, last month?" — with a per-day summary, to track
momentum. The data already exists in `mail_messages`; it just isn't visualized.

## Decision
A new **Tracker** tab (`/tracker`) derived entirely from the classified `applied` emails — **no new
LLM calls, no new schema, no fabricated data** (every count is a real confirmation email).

- **API** `GET /api/mail/stats` returns the raw `applied` events (timestamp, company, subject, AI
  summary) plus per-category `totals` for funnel context. It deliberately returns *events*, not
  pre-bucketed counts, so the **client buckets by the user's local day/week/month** — making "today"
  correct in the browser's timezone (the server is UTC).
- **Bucketing** lives in `lib/trackerStats.ts` — pure, timezone-aware functions (`series`,
  `momentum`, `currentStreak`, `groupByDay`, `dayExtremes`) that are unit-tested directly.
- **UI** (`app/(app)/tracker/page.tsx`):
  - Momentum cards: Today / This week / This month / All-time, with streak, per-active-day average,
    and best day.
  - A **Daily / Weekly / Monthly** toggle over a zero-filled bar chart (last 30 days / 12 weeks /
    12 months) so gaps and trends read at a glance.
  - A **Pipeline** strip (Applied → Shortlisted → Assessments → Action needed → Rejections) for
    conversion context, from the category totals.
  - A **Day-by-day** accordion: each day shows the count + a preview of companies, expanding to the
    individual applications with time, company, and the AI's one-line summary — the "summary for that
    day" the user asked for.

## Why client-side bucketing (not SQL `date_trunc`)
Single-user scale (hundreds–low-thousands of emails) makes fetching the slim `applied` rows trivial,
and timezone correctness is free when the browser does the grouping. Supabase-JS has no ergonomic
`GROUP BY`; an RPC/materialized view would be more moving parts than this needs. If volume ever grows,
swap in a server aggregation behind the same response shape.

## Alternatives considered
- **Extend the Inbox daily table** — rejected: the user explicitly wanted a *dedicated* tracking area
  with weekly/monthly views and per-day drill-down, which would overload the Inbox.
- **Track applications from the Jobs page `applied_at`** — rejected as the primary source: that only
  covers jobs found *through* ApplyPilot and manually marked applied; the confirmation emails capture
  everything the user applied to anywhere. (The two can be reconciled later if useful.)
- **A new LLM "summarize my day" call** — unnecessary: the per-email classification already carries a
  one-line summary; the day view composes those, keeping it cheap and non-fabricated.
