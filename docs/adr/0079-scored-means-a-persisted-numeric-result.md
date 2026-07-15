# ADR 0079 — “Scored” means a persisted numeric AI result

**Status:** accepted · **Date:** 2026-07-14 · **Relates to:** ADRs 0004, 0028, 0049,
0065, 0069, and 0073

## Context

The live Pilot 2 account exposed two different failures behind one confusing UI symptom:

- a manual Tailor & Apply job had `status='scored'` while `fit_score` and `scored_at`
  were null, so the dashboard counted it as scored while the score badge showed “–”;
- automatic scoring was stuck at 0/348 because OpenAI's permanent
  `insufficient_quota` 429 was retried like a temporary rate limit until the serverless
  invocation died, before the documented visible score-0 fallback could be written.

Archive restore could create the same status/score mismatch. Delegated progress also
counted any row that left `unscored` as “scored,” even if it was filtered or archived.
The subscription worker had additionally drifted behind the direct scorer's combined
company fields, and Pilot 3 had an unmistakable Apify token saved in its OpenAI lane.

## Decision

- Enforce at PostgreSQL that `status='scored'` requires non-null `fit_score`. Migration
  0047 repairs existing violations to `unscored` before adding the constraint.
- Manual Tailor & Apply jobs remain truthfully unscored and are excluded from the
  automatic scoring queue and scraped-workspace statistics by `source='manual'`.
- Dashboard scored counts and delegated progress require a numeric `fit_score`; score 0
  is numeric, terminal, and visible. Progress/status copy says “processed” where work can
  include a non-scoring filter result.
- Permanent billing/quota 429s fail immediately into the existing score-0 persistence
  boundary. Temporary 429/503 responses retain backoff. Database write failures count as
  errors and are logged rather than being reported as completed.
- Direct and subscription scoring persist the same score, breakdown, employment,
  company assessment, tech stack, and usage fields. A missing/error employment result
  does not erase deterministic actor-derived employment metadata.
- Reject only unambiguous cross-provider credential prefixes at vault entry. Do not guess
  from generic prefixes shared by multiple providers.

## Consequences

- The UI cannot claim that an absent score is scored, across any user account.
- A bad/empty credential configuration remains unscored with a visible request error;
  an actual provider call that fails permanently records score 0 and its error reasoning,
  preserving the no-fabrication rule.
- Real positive AI scores still require that each user configure a valid funded API key
  or connect their own supported subscription. Account isolation and the onboarding-only
  shared subscription exception are unchanged.

## Verification

Apply migration 0047, prove there are no `scored + NULL` rows for any configured user,
exercise score 0 and positive score progress, verify a permanent quota 429 makes one
request only, and run both direct-parser and worker-parser regression suites.
