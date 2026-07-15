# ADR 0080 — Owner-neutral prompts and per-user candidate context

**Status:** accepted · **Date:** 2026-07-14 · **Amends:** ADRs 0030 and 0067

## Context

The application became multi-user in ADRs 0072–0074, but the two runtime copies of
`SCORE_PROMPT` still encoded the original owner's F-1 OPT/EAD status and future H-1B
need. They also treated every citizenship, residency, and clearance requirement as a
hard block without checking the current candidate. This could reject an eligible user
or apply another person's immigration assumptions to their score.

The structured `profile.base_resume` was already user-owned and supplied dynamically to
scoring and tailoring. `profile.work_authorization` was user-owned too, but the scorer
did not receive it. Onboarding's résumé parser also discarded explicitly written
authorization facts, and ApplyBuddy could retain stale résumé snapshots after the user
edited the Base résumé.

## Decision

Keep shared task instructions stable and owner-neutral. Do not create or persist a
separate prompt template for each account. Instead, build a fresh, RLS-scoped candidate
context for every AI invocation:

- scoring receives the authenticated user's structured Base résumé plus only that
  user's `profile.work_authorization` JSON;
- tailoring and cover letters receive the authenticated user's Base résumé JSON;
- ApplyBuddy receives current structured profile fields and Base résumé, with the
  current Base résumé replacing onboarding-era résumé snapshots;
- onboarding may copy work-authorization fields only when the uploaded PDF states them
  explicitly. It must not infer them from name, location, school, or employer.

Eligibility is a score-1 hard block only when the posting has a non-negotiable condition
and the candidate context explicitly proves that this candidate cannot meet it. Missing
authorization, citizenship, residency, sponsorship, or clearance data means unknown,
not no; the scorer continues and tells the user what to confirm.

Keep local ATS/prefilter input résumé-only. `getScoringResumeText()` remains the
deterministic résumé view, while `getScoringCandidateContext()` adds authorization facts
only for the LLM scorer. Both the Netlify/direct scorer and subscription worker mirror
this contract.

## Consequences

- No source prompt contains the previous owner's résumé or immigration status.
- Different accounts use the same reviewed rubric but receive different private
  candidate context under forced RLS and UUID-scoped worker calls.
- Users update résumé facts under **Tailor & Apply → Base résumé** and eligibility facts
  under **Profile → Work Auth**. New scores/generations use saved changes immediately;
  existing scores and generated files are historical and must be rerun.
- The clearance and no-sponsorship evals now include explicit candidate eligibility
  facts. An eligible citizen/clearance case guards against reintroducing owner-wide
  blockers.
