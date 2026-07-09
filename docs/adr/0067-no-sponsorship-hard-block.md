# 0067 — Hard-block postings that will never sponsor a visa

## Context

The candidate is on **F1 OPT/EAD**: authorized to work in the US *now* without sponsorship, but
will require **H-1B/visa sponsorship in the future**. The Phase-1 HARD BLOCK in `SCORE_PROMPT`
(ADR 0022, refined by ADR 0030) already floors the score to `1` for postings the candidate can
never be considered for — US citizenship, green card/permanent residency, active/obtainable
security clearance, and ITAR/EAR "US Persons only".

Postings that state they **will not sponsor a work visa, now or in the future** were slipping
through: a strong skills match would score 7–9 and rank near the top of the shortlist, even though
the role is a dead end for someone who needs future sponsorship. (The candidate's base résumé even
claims "no sponsorship required," so the model had no signal to down-rank these on its own.)

## Decision

Add a fifth HARD BLOCK bullet to Phase 1 of `SCORE_PROMPT`: when the posting **categorically
refuses to sponsor a visa now or in the future** ("we do not / will not sponsor", "no visa
sponsorship", "unable to sponsor", "must have permanent work authorization that does not require
sponsorship", etc.), set SCORE to `1` and stop — the same treatment as the citizenship/clearance
blockers.

The prompt hard-codes the candidate's status ("The candidate is on F1 OPT/EAD…") because this is a
single-user app and that assumption overrides whatever the résumé claims about sponsorship.

**Guard against over-blocking:** the bullet explicitly says NOT to block a posting that merely
requires *current* work authorization or asks "are you legally authorized to work in the US?" — the
candidate IS authorized on OPT/EAD, so those roles stay eligible. Only an explicit refusal to *ever*
sponsor triggers the block.

Applied to **both** prompt copies: `lib/scoring.ts` (direct-API + `/llm` paths) and
`resume-worker/scoring.js` (production subscription `/score-jobs` path). *(Worker Mac must be
redeployed for the production path to pick this up.)*

## Consequences

- Two new eval cases: `no-sponsorship-blocked` (strong fit + "unable to sponsor now or in the
  future" → score exactly 1) and `current-auth-not-blocked` (strong fit + "must be authorized to
  work at time of hire", no sponsorship refusal → scores 6–10, the over-block guard).
- No parser/schema change — the blocker reuses the existing score-`1` + NOTE path.
