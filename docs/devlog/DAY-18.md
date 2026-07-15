# DAY 18 — 2026-07-14 (multi-user scoring truthfulness)

## Diagnosis

- Pilot 2 had one manual job marked `scored` with null `fit_score`, so dashboard status
  contradicted the score badge. The automatic session was stale at 0/348.
- A live credential probe showed Pilot 2's active OpenAI key returns permanent
  `insufficient_quota`; the client retried that 429 until the serverless invocation died.
- Pilot 3's OpenAI lane contained the exact same Apify token already stored correctly in
  its Apify lane. User 1 had no keys or jobs after its requested reset.
- Delegated progress treated any non-unscored status as an AI score, database write
  failures were undercounted, archive restore could recreate scored/null rows, and the
  subscription scorer did not persist the direct scorer's company fields.

## Implementation

- Added migration 0047: repair scored/null rows and enforce that every scored row has a
  numeric fit score. Manual application jobs are now honestly unscored and excluded from
  the scraped automatic queue/statistics.
- Made statistics and delegated progress use numeric `fit_score`, made archive restore
  score-aware, surfaced score-selected HTTP failures in the UI, and changed mixed-work
  progress language from “scored” to “processed.”
- Permanent billing/quota 429s now fail fast into the visible score-0 boundary; temporary
  rate limits still back off. Every scoring database write is checked and counted.
- Restored company-tier/tech-stack parity in subscription scoring and added an
  unmistakable credential-prefix guard for future vault entries. Failed/old-format AI
  responses no longer erase employment type already supplied by the job actor.
- Recorded the durable invariant and failure behavior in ADR 0079, Architecture, and PRD.

## Verification

- Migration 0047 applied live. All three user scopes report zero `status='scored'`
  rows with null fit score; Pilot 2's manual row became unscored and stays outside the
  348-row scraped queue. Its stale scoring lock was released.
- Removed Pilot 3's invalid OpenAI row after proving it was byte-identical to the token
  already retained in its valid Apify row. New vault requests reject this mismatch.
- Pilot 2's quota failure completed in 0.91s, persisted visible score 0 + error reasoning,
  completed delegated-progress semantics, and preserved actor employment metadata; the
  probe row was then restored.
- All three UUID-scoped Claude contexts returned the requested scoring smoke result.
  Set every account's Everything else lane to `subscription/haiku` (owner legacy login;
  Pilot 2/3 their own connected Claude accounts).
- A real Pilot 2 job then traversed authenticated web delegation → worker → RLS database
  in 11.6s and persisted numeric fit score 1, note, reasoning, breakdown, company tier
  + note, tech stack, usage, and employment. `/api/jobs?status=scored` returned that score,
  while `/api/stats` reported exactly 1 scored / 347 unscored and distribution `[[1,1]]`.
- App: 184 tests passed (8 credentialed evals skipped), typecheck and the 33-page build
  passed. Backend 2/2, worker 7/7, and documentation checks passed (107 Markdown files,
  73 ADRs). Public gateway health passed and worker `/version` advertised
  `score-company-parity` after restart.
- After the manual migration, PostgREST retained a stale schema cache and rejected run
  creation with a missing `runs.apify_api_key_id` cache error. Restarted the REST
  container and proved that column through a public-gateway insert/read/delete probe.
  Added the mandatory manual-migration REST restart to the backend runbook.
