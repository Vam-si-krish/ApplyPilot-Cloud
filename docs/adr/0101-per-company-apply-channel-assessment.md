# ADR 0101: Per-company apply-channel assessment

- Status: accepted
- Date: 2026-07-19
- Amends: ADR 0065 (merge company assessment into scoring)

## Context

The per-job `COMPANY_TIER` (good/medium/low/unknown, ADR 0065) conflated two independent
questions — "is this employer legitimate?" and "does applying actually reach the
employer?" — and judged them per posting. Analysis of the production database (6,674
jobs) showed the cost of that design:

- ~25% of rows were intermediary postings (aggregator reposts such as Jobgether,
  Jobright.ai, Hire Feed; talent marketplaces such as Turing; gig platforms such as
  DataAnnotation, which alone was 8% of the database), and ~22% of the fit-score ≥7
  shortlist routed the user into an intermediary's signup funnel rather than a real
  application. Only a small fraction was tiered `low`, because the deliberately
  conservative tier prompt had no correct category for "legitimate company,
  waste-of-time application".
- Judging the same company independently on every posting produced contradictory
  verdicts (one company received all four tiers across 122 postings) and paid for the
  same judgment hundreds of times.
- `application_url` is `linkedin.com` for effectively all scraped rows, so URL-based
  detection has no signal; the reliable signals are the posting company's name and the
  posting text plus the model's world knowledge.

## Decision

- Assess each **company** once, not each job. A shared `company_assessments` table keyed
  by the normalized company name (`company_key`: whitespace-collapsed, trimmed,
  lowercased) caches the verdict for all users; assessments contain no personal data.
- Two orthogonal axes, both line-prefixed and parsed defensively (invalid enum →
  `unknown`; a mangled block leaves the company unassessed — never fabricated):
  - `apply_channel`: `direct | staffing | aggregator | talent_marketplace |
    gig_platform | unknown` — who actually receives the application. Channel is
    classified confidently; an employer's own external ATS (Workday, Greenhouse, …)
    remains `direct`.
  - `trust`: `established | plausible | suspicious | unknown` — legitimacy. This axis
    stays conservative: `suspicious` requires concrete scheme signals, never smallness
    or anonymity.
- One batched LLM call (scoring lane, up to 15 companies) assesses the companies of a
  scoring chunk before the per-job scoring calls; the apify webhook stamps freshly
  inserted rows whose company is already cached. A guarded backfill route
  (`/api/company-assessments/backfill`) walks existing jobs the same chunked way.
- The effective verdict (user override wins) is denormalized onto `jobs.apply_channel`
  and `jobs.company_trust` by the `apply_company_assessments` SQL function (SECURITY
  INVOKER, so user-scoped requests only stamp their own rows). List filtering and
  pagination stay plain column filters; "Hide time-wasters" =
  `apply_channel ∈ {aggregator, talent_marketplace, gig_platform}` OR
  `trust = suspicious`, with unassessed rows always left visible.
- Users can correct a verdict from the job details panel; the correction is stored as
  `override_channel`/`override_trust` on the shared row, re-stamps that company's jobs,
  and survives future assessment passes (`ignoreDuplicates` upserts never clobber it).
- `SCORE_PROMPT` drops its COMPANY ASSESSMENT section (the scoring call returns to pure
  résumé↔role fit; `TECH_STACK` stays). The parser keeps accepting `COMPANY_TIER`
  lines, and existing `company_tier` values are preserved and rendered only where no
  per-company verdict exists.
- Scoring discipline is unchanged: exactly one scoring LLM call per job; the amortized
  per-company call is additional, cheap, and its failure never blocks scoring.
- Regression net: `evals/company-cases/` + `evals/company-assessment.evals.test.ts`
  (live batched call when a key is present). The guard cases pin the over-filtering
  boundaries: external-ATS employer stays `direct`, staffing stays `staffing`, small
  unknown startups are never `suspicious`.

## Consequences

- The Jobs list can hide intermediary-funnel postings by default while keeping every
  verdict visible, explainable (note on the badge/details), and correctable.
- Company verdicts are consistent across postings and cost one call per company for its
  lifetime instead of one judgment per posting.
- A company that legitimately changes character (e.g. an agency that starts direct
  hiring) keeps its cached verdict until a user override or a manual cache change; no
  automatic re-assessment is scheduled yet.
- The legacy per-job tier remains read-only display/filter surface for pre-cutover rows
  and can be removed once those rows age out.
