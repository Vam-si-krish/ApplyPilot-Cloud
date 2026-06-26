# ADR 0038 — Scoring calibration: shortlisting lens, no overqualification penalty, soft years, anti-fabrication

**Status:** accepted · **Date:** 2026-06-26 · **Supersedes the weighting of** ADR 0022 (keeps Phase-1 validation + the weighted-rubric idea; recalibrates the behaviours and collapses 5 dimensions → 3)

## Context
Real-world misjudgements surfaced from the live scorer (running on GPT-4o-mini):

1. **Fabricated years.** For a "Senior React, 8+ years" posting the reasoning confidently asserted *"The
   candidate has over 8 years of frontend development experience"* and gave experience 25/25 — even though
   the résumé does not evidence 8 years. The model was echoing the posting's required-years number back as
   if it were a fact about the candidate (requirement→anchor hallucination, which small models do readily).
2. **Overqualification → score 1.** Candidates clearly able to do a role were sometimes scored 1 (the
   "non-match" / hard-block band) purely for being overqualified. ADR 0022's EXPERIENCE dimension told the
   model to "penalize … clear OVER-qualification", and the model over-applied it.
3. **Years treated as a hard gate.** A modest years shortfall could read as a missing must-have and trip the
   `≤4` cap, even with a strong matching stack.

The user's goal for the score is explicitly **"maximise my chances of getting shortlisted"** — i.e. *is this
worth applying to* — not *is this a perfect mutual fit*. Overqualification and slightly-short years rarely
stop a recruiter from shortlisting a strong candidate, so penalising them works against the tool's purpose.
The scorer is 100% prompt-driven (no code post-processes `seniority`/score), so this is a `SCORE_PROMPT` change.

## Decision
Recalibrate `SCORE_PROMPT` (`lib/scoring.ts`); output format, fields, parser, and one-call/error→0 discipline
are unchanged.

- **Shortlisting lens.** The objective is reframed to *predict how likely THIS candidate is to be shortlisted
  for THIS role* (worth-applying), instead of generic mutual fit.
- **Anti-fabrication, hardened.** Explicit rule that a requirement in the posting is **not** evidence about the
  candidate; Phase 2 now begins by establishing the candidate's **evidenced years from the résumé only** (or
  "not specified"), and REASONING must state that figure and never claim a years/seniority bar the résumé
  doesn't show.
- **Overqualification is never a penalty.** EXPERIENCE awards full/near-full credit when the candidate meets
  **or exceeds** the level; deduct only a little, and only on a genuine band collision (Principal → true
  entry/intern). The 1–2 band explicitly excludes "overqualified".
- **Years are soft.** A "years" number is a soft requirement; a ~2–3 year shortfall is at most a small
  deduction, never a disqualifier, and a years shortfall alone does **not** trigger the `≤4` must-have cap.
- **Cap reserved for CORE gaps.** The `≤4` gate fires only on missing core technical skills / a mandatory
  degree-cert-license / a Phase-1 blocker.
- **Three-dimension rubric (was five).** Because the user **tailors every job they apply to**, the score is a
  triage gate that should predict *post-tailoring* competitiveness. Bonus (nice-to-have) and Logistics were
  low-signal for that decision and were **removed**; the 0–100 budget is now **Skills 60 / Role relevance 25 /
  Experience & seniority 15**. The `BREAKDOWN` output line, `ScoreBreakdown` type, and parser drop
  bonus/logistics; `JobDetails` renders three rows (and still renders the legacy five for pre-0038 rows, which
  carry `bonus`/`logistics`).
- **Tailoring-aware skills.** Skills credit a skill the candidate *genuinely has* even if the base résumé only
  mentions it in passing (a tailored résumé will foreground it) — but **never** a skill they lack (tailoring is
  truthful; a fabricated skill surfaces in the interview). Role relevance is the irrelevance guard
  (off-discipline → near 0); industry vertical matters far less than role type.

Phase 1 (invalid→0, citizenship/clearance→1) is untouched. The same scorer also powers the tailored-résumé fit
score (ADR 0029), so the tailored-fit chip benefits from all of the above too.

## Consequences
- Strong candidates who are overqualified or a little short on stated years now score on their merits instead
  of being dumped to 1–4 — better aligned with "should I apply".
- Reasoning is honest about evidenced experience, so a remaining mistake is *visible* rather than a confident
  fabrication.
- New eval cases lock the behaviour in: `overqualified-still-fits` (≥6) and `under-years-strong-skills` (≥5,
  proving the years cap doesn't fire). Existing cases keep their bands (strong-match high, domain mismatch
  1–4, clearance exactly 1, invalid 0).
- Model note: GPT-4o-mini is the cheapest tier and the most prone to the anchoring failure above. The fixes
  help on any model, but for best results bump the **Scoring** model in Settings (e.g. GPT-4.1-mini / GPT-4o /
  Gemini 2.5 Flash / Claude) — the user has no cost concern.

## Alternatives considered
- **Add a structured "evidenced_years" output line** — rejected for now; it would touch the parser/types, and a
  forceful REASONING instruction + the "don't borrow the posting's number" rule address the fabrication without
  schema churn. Revisit if fabrication persists on the upgraded model.
- **Drop seniority penalties entirely** — rejected; genuine under-qualification (can't do the job) should still
  score low. Only overqualification and bare years shortfalls are de-penalised.
