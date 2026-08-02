# ADR 0117: Saved and independently active LinkedIn URL library

- Status: accepted
- Date: 2026-08-02
- Amends: [ADR 0113](0113-linkedin-scraper-adapter-registry.md)
- Relates to: [ADR 0057](0057-duplicate-posting-dedup.md) and
  [ADR 0071](0071-same-day-only-dedup.md)

## Context

The Curious Coder adapter already accepted up to 20 filtered LinkedIn searches, but
Settings represented them as one newline-delimited textarea. That made adding a second
source hard to discover and coupled persistence to participation: every saved URL was
always active, so temporarily excluding a search meant deleting and later reconstructing
it.

Overlapping searches also commonly return an identical posting. The per-user jobs URL
unique key made persistence idempotent, and the content-duplicate pipeline collapsed
same-day variants with different URLs, but the webhook still performed local match work
over repeated exact URLs in the actor dataset.

## Decision

- Keep a validated, ordered library of at most 20 URLs in
  `settings.linkedin_search_url_options`. Preserve `settings.linkedin_search_urls` as the
  independently active subset and as the adapter's run input for backward compatibility.
- Migrate every existing active URL into the saved library without changing which URLs
  participate in the next run.
- Replace newline editing with one Add control and a table of saved sources. Each row has
  an Active checkbox and Remove action. Adding a valid URL saves it in local page state
  and activates it by default; the existing Save settings action persists the complete
  library and active subset together.
- Validate and normalize both arrays at the authenticated Settings API boundary,
  de-duplicate them in insertion order, promote any newly active URL into the library
  (including during an old-frontend/new-backend deployment overlap), and retain the
  existing requirement that the selected URL-driven actor has at least one active source.
- Before local ATS matching and database upsert, keep the first mapped job for each exact
  dataset URL. The existing `(user_id, url)` unique constraint remains the final
  idempotency guard. Different job URLs with the same company/title/day continue through
  ADRs 0057/0071 rather than being deleted.

## Consequences

- A user can keep reusable LinkedIn filter combinations without fetching all of them and
  can activate several sources in one run.
- The actor's global `count` remains a cap across the active URL set; it is not multiplied
  into an independent cap per URL.
- Exact overlapping results do no duplicate local work or rows. Same-day content variants
  remain reachable as sibling locations under one visible Jobs row, preserving the
  established apply-once grouping semantics.
- The new column remains inside the existing forced-RLS, UUID-scoped Settings row; no new
  public endpoint, credential, actor, or cross-user relationship is introduced.

## Verification

1. Existing `linkedin_search_urls` backfill into `linkedin_search_url_options` unchanged.
2. URL validation de-duplicates both lists and promotes a newly active URL into the library.
3. A run plan sends only active URLs, including more than one when selected.
4. Repeated dataset job URLs map to one ingest candidate; different job URLs continue to
   the existing content-group linker.
5. Application, backend/isolation, type, build, documentation, migration, backup, deploy,
   and production health gates pass without starting a billable actor run.
