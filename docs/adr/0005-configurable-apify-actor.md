# ADR 0005 — Configurable Apify actor, LinkedIn default
**Status:** accepted · **Date:** 2026-06-17
## Context
Apify job-board actors each have their own input schema and output shape. The brief wants the
actor to be swappable and the input mapped from the user's keywords × locations + a last-24h window.
## Decision
Default actor `bebity~linkedin-jobs-scraper`; the actor id is stored in `settings.apify_actor_id`
and overridable in the Settings UI. All actor-specific input mapping lives in `lib/apify.ts`
(`buildActorInput`) and output mapping in `mapDatasetItemToJob`, isolating schema knowledge to
one file. Ingestion de-dupes by `url` and only triggers a detail fetch if `full_description` is missing.
## Alternatives considered
- **Hard-code one actor** — rejected: brief explicitly wants it configurable.
- **Indeed actor default** — viable; LinkedIn chosen as default because the Lite app's primary
  discovery path is LinkedIn and its descriptions include the apply URL inline.
- **Multi-actor fan-out in one run** — deferred: start with one actor; can add per-board actors later.
## Notes
The exact field names of `bebity~linkedin-jobs-scraper` output must be confirmed against a real
run; `mapDatasetItemToJob` is written defensively (multiple candidate keys) and is the single place
to adjust when the real schema is known.
