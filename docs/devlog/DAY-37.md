# Day 37 — Per-company apply-channel assessment and time-waster filtering

**Date:** 2026-07-19  
**Branch:** `develop`

## Goal

Make the company legitimacy filter actually catch waste-of-time applications — postings
by micro1/Jobgether-style intermediaries that route the candidate into their own portal,
talent pool, or gig platform instead of reaching the named employer.

## What the data said (read-only analysis of production, 6,674 jobs)

- ~25% of rows were intermediary postings: DataAnnotation alone 527 rows (8%); repost
  boards (Jack & Jill, Hire Feed, Haystack, RemoteHunter, Jobright.ai, Jobgether, …)
  721 rows; Turing 50. About 22% of the fit ≥7 shortlist routed into an intermediary
  funnel.
- The conservative per-job `COMPANY_TIER` had no category for "legitimate company,
  waste-of-time application", so most offenders landed in medium/unknown — and the same
  company received contradictory tiers across postings (Jack & Jill: all four tiers
  over 122 rows).
- `application_url` is `linkedin.com` on effectively every scraped row, so URL-based
  detection has no signal. Company name + posting text + model world knowledge is the
  signal.

## Implemented (ADR 0101)

- **Migration 0053**: shared `company_assessments` table (normalized `company_key` PK,
  `apply_channel` direct/staffing/aggregator/talent_marketplace/gig_platform/unknown,
  `trust` established/plausible/suspicious/unknown, note/model, user override columns);
  `jobs.company_key` backfilled in SQL (lockstep with `normalizeCompanyKey`); stamped
  `jobs.apply_channel`/`company_trust`; `apply_company_assessments()` SECURITY-INVOKER
  function stamps override-first verdicts under the caller's RLS scope.
- **`lib/companyAssessment.ts`**: batched assessment prompt (≤15 companies per
  scoring-lane call), defensive line-prefixed parser (invalid enum → unknown; mangled
  block → company left unassessed, never fabricated), candidate dedupe, upsert with
  `ignoreDuplicates` so user overrides are never clobbered, stamping helpers.
- **Wiring**: `scoreJobRows` assesses a chunk's new companies before scoring (guarded —
  assessment failure never blocks scoring); the apify webhook stamps fresh rows of
  already-known companies; `POST /api/company-assessments/backfill` walks existing jobs
  chunk-by-chunk (Jobs → More filters → "Assess companies" loops it until done);
  `PATCH /api/company-assessments` stores per-company corrections and re-stamps.
- **`SCORE_PROMPT`** dropped its COMPANY ASSESSMENT section — scoring is pure
  résumé↔role fit again (TECH_STACK stays). The parser still accepts old-format
  responses; legacy `company_tier` values are preserved and rendered/filterable only
  where no per-company verdict exists.
- **UI**: `ApplyChannelBadge` (suspicious trust outranks the channel label), a company
  channel filter, and a default-ON **"Hide time-wasters"** toggle (aggregator +
  talent-pool + gig-platform + suspicious; unassessed companies always stay visible;
  the active-filter chip keeps the hiding visible). Job details show the verdict, its
  note, and a correction dropdown.
- **Tests**: `lib/companyAssessment.test.ts` units plus `evals/company-cases/` with a
  live batched harness. Guard cases pin the over-filtering boundaries: an employer's
  own external ATS is `direct`; a staffing firm with a real client is `staffing`, not
  an aggregator; a small unknown startup is never `suspicious`.

## Open questions

- Cached verdicts never expire; a company that changes character needs a manual
  correction (or a future re-assessment pass).
- After this merges to production: run "Assess companies" once to backfill (~2k
  companies ≈ ~140 batched scoring-lane calls), then spot-check the red badges before
  trusting "Hide time-wasters" long-term.
