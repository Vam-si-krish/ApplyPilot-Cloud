# ADR 0112: Model-judged header location on tailored résumés

- Status: accepted
- Date: 2026-07-25
- Amends: [ADR 0104](0104-opt-in-ai-apply-and-assessment-calendar.md) (the `use_job_location_on_tailored_resume` preference)

## Context

The opt-in header-location swap copied the job row's location string verbatim into the
generated copy's header. That produces wrong-looking headers in the common cases: remote
rows carry fetcher-formatted strings ("Remote — Los Angeles Metropolitan Area"), many
postings use vague regions ("United States") or marketing areas ("Greater Boston Area"),
and a posting one town over (Cambridge for a Boston candidate) would replace a header
that already reads as local with a city the candidate doesn't live in. Deciding "is this
the candidate's metro, and what is the clean city form?" is a judgment call, not string
matching — and the owner's standing preference is AI judgment over hand-written
heuristics.

## Decision

- When the preference is on, the tailoring call itself judges the header location: the
  VALIDATED TAILORING CONTROLS gain a rule directing the model to output a top-level
  `resume_location` field — home location for remote/missing/vague/same-metro jobs;
  the job's city normalized to "City, ST" (or "City, Country") only when the job is
  clearly in a different metro. The TARGET JOB block now carries the job row's
  `Location:` line so the model can see it. No extra LLM call.
- The verbatim `job.location` overwrite is removed on both tailoring paths (worker and
  direct). The merged résumé takes the sanitized `resume_location` (single line, ≤ 60
  chars) when present; a missing or junk field keeps the Base home location, and the
  field is ignored entirely when the preference is off.
- The Base résumé and saved home location remain untouched, per ADR 0104.

## Consequences

- Headers read like a real person's location in every rule row; the raw fetcher string
  can no longer leak into a résumé.
- The location choice inherits the tailoring model's quality; the deterministic
  fallback (keep home) makes the failure mode the pre-feature behavior, never a wrong
  city. The rule text lives in the volatile instructions block, so prompt caching of
  the stable prefix is unaffected.
