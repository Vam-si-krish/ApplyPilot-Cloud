# Devlog — Day 4 (2026-06-20)

Continued from Day 3. Big session: Gmail two-phase sync, Tracker, per-location→single combined query,
search libraries, skill-match + skill gate + bulk workflow, Netlify scheduling, filter overhaul,
Easy-Apply vs portal segregation (broadened to all job boards), and now scoring v2.

## Scoring v2 + contract flagging (ADR 0022)
User approved evolving the (previously frozen) scorer; researched open-source résumé↔JD matchers first.
- **`SCORE_PROMPT` v2:** recruiter persona; weighted rubric (must-haves 40 / experience+seniority 25 /
  domain 20 / nice-to-have 10 / logistics 5) → 1–10 with a **hard gate (missing must-have ⇒ ≤4)**;
  seniority over/under-qualification; anti-hallucination. New output lines EMPLOYMENT / SENIORITY /
  BREAKDOWN / MISSING. `scoreJob` now max_tokens 1000, temp 0.1. Still one call/job; error → 0.
- Migration 0017: `jobs.score_breakdown jsonb` + `employment_type`. `scoreRunner` persists them.
  `JobDetails` shows the sub-score breakdown + missing must-haves + seniority.
- **Contract:** `employment_type` flags contract/internship roles → row badge + employment filter
  (surfaced, never auto-dropped). `COMPANY_PROMPT` fixed so legit staffing/contract roles aren't rated
  `low` — `low` is reserved for real time-wasters (lead-gen/upsell/harvesting/fake reposts).
- Tests: scoring.test covers the new parser fields; CLAUDE.md "frozen prompt" rule retired (ADR 0022).

## Still pending
- **Mobile-friendly** responsive pass (chosen to do after scoring).
- Deploy everything (Netlify scheduled functions + all the above). Existing scored jobs keep their v1
  scores until re-scored; new runs use v2.
