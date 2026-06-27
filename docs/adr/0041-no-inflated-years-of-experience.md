# ADR 0041 — Never inflate years of experience (tenure is a verifiable fact)

## Status
Accepted (2026-06-27)

## Context
The per-job tailorer (ADR 0026) is allowed to ENHANCE the résumé — add adjacent/quick-to-learn
skills, expand real bullets, reframe the summary. `mergeTailored` already anchors the
**verifiable identity facts** a background check would catch (employer names, job titles,
employment dates, locations, education) to the base résumé, restoring them no matter what the
model returns.

But **total years of experience** is also a verifiable fact — it falls out of the employment
dates — and it was left *unguarded*. The free-text summary, label, and bullets could state any
tenure the model liked. On a real run the tailorer wrote **"8+ years of professional experience"**
into the summary to match a posting's "8+ years" requirement, for a candidate whose dates support
~6. That is a fabrication of the same kind ADR 0026 anchors away for employers/titles/dates, and
it is exactly the sort of claim that collapses in an interview or a reference check. The prompt's
"no absurd seniority" line gave the model no actual number to respect.

## Decision
Treat tenure as an anchored fact, with the same two-layer discipline used elsewhere (tell the
model the truth in the prompt **and** enforce it deterministically in `mergeTailored`). Applied to
both hand-synced copies — `lib/resumeTailor.ts` and `resume-worker/tailor.js`:

1. **Compute the true span.** `totalExperienceYears(base)` derives the career span from the base
   résumé's employment dates: earliest start → latest end (an open/"Present" role counts to *now*),
   floored to a whole year. This is the most generous *defensible* figure, so it doubles as the
   ceiling. It parses the common date formats (`2019-03`, `Mar 2019`, `03/2019`, bare `2019`) and
   returns `null` when nothing parses (then no number is asserted or clamped).
2. **Tell the model.** The cached base block now carries `TOTAL PROFESSIONAL EXPERIENCE: about N
   years … Do NOT claim … more than N years anywhere`, and the prompt gains a `NEVER INFLATE
   TENURE` rule alongside the existing plausibility guidance.
3. **Clamp deterministically.** `clampYoeClaims` rewrites any "N years" / "N+ yrs" claim that
   *exceeds* the true span down to it, applied in `mergeTailored` to the summary, label, and every
   bullet. A truthful "5 years" within range is untouched; a fabricated "8+ years" on a 6-year
   history becomes "6+ years". Four-digit years and unrelated numbers are not matched.

## Consequences
- The résumé can never overstate total experience past what the dates support — prompt + clamp,
  belt-and-suspenders, same as the em-dash guard (ADR 0033) and the fact-anchoring (ADR 0026).
- The clamp only ever *reduces* an overstatement; it never invents or raises a figure, and is a
  no-op when the span is unknown, so it can't corrupt a truthful résumé.
- The span is earliest-start→latest-end (gaps included). This intentionally allows the *maximum*
  defensible number rather than a gap-adjusted one; the goal is to block gross inflation, not to
  litigate a month here or there. Reframing the label (e.g. "Senior Frontend Developer" →
  "React JS Developer") and adding adjacent skills remain allowed — those are not tenure claims.
- Prompt-and-code only; no schema/migration. Worker redeploy/restart required for the running
  worker to pick up the synced `tailor.js`.
