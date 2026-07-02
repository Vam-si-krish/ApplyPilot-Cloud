# ADR 0054 — Tailoring prompt v3: title alignment, exact-term mirroring, top-third summary

**Status:** accepted · **Date:** 2026-07-02 · **Builds on:** ADR 0026/0031/0033/0041/0051 (tailoring), ADR 0053 (ATS match)

## Context
A research pass over what actually drives recruiter shortlisting found the tailoring prompt was
missing the three highest-leverage, well-evidenced signals:
- **Job-title match** is the strongest single callback factor measured (≈3.5× more interviews when
  the résumé headline matches the posting's title); recruiters pattern-match the title in a
  ~7-second scan. The prompt let the model rewrite `basics.label` but never told it to align it.
- **Exact keyword forms** — many ATS filters match literally ("CI/CD" ≠ "continuous integration");
  the prompt asked for "a strong keyword match" but not the posting's exact spelling.
- **Top-third rule** — recruiters spend ~80% of the first scan on the top third of the page and
  quantified lines draw ~2.3× the eye fixation; the prompt didn't tell the summary to lead with
  role-matching, quantified facts.
- Minor: mandating every bullet be 180–210 chars produced uniform two-line bullets, which reads
  templated — contradicting the prompt's own "vary shape" rule.

Kept deliberately (user decision): the "add skills learnable in ~15 days" enhancement policy —
every résumé is reviewed before use, and manual instructions (ADR 0037) can dial it back per job.

## Decision
1. **Prompt additions** (identical in `lib/resumeTailor.ts` and the production port
   `resume-worker/tailor.js`): TITLE ALIGNMENT (set `basics.label` to an honest variant of the
   target title; never adopt a seniority the dates don't support), MIRROR THE POSTING'S EXACT
   WORDING (skills and key phrases verbatim as the posting writes them), SUMMARY top-third rules
   (first line answers the posting; 2–3 strongest role-matching quantified facts).
2. **Bullet lengths varied**: each role opens with its strongest bullet at ~180–210 chars; the rest
   may run ~110–210. Ordering by relevance to THIS job is now explicit.
3. **ATS feed-forward**: `TailorSignals.atsMissing` — the exact posting-form terms the base résumé
   lacks, from the ATS scan (ADR 0053, `jobs.prefilter_breakdown.missing`) — listed in the prompt
   with "mirror the truthful ones verbatim". Wired in the worker (`tailorSignals()`, now also used
   by `/tailor` inline) and computed on the fly in the manual paste-a-JD route (no job row needed).
   Combined with the post-generation tailored ATS check (ADR 0053 addendum), this closes the loop:
   missing terms go in before the call, the gauge verifies coverage after it.

## Consequences
- The Worker Mac must `git pull` + restart for the production tailor path to pick this up
  (the cloud copy only serves the manual paste-a-JD flow).
- Tailored résumés will show a job-aligned headline — the review step (ChangesReview) still shows
  everything before use; the label remains clamped by the tenure guard (ADR 0041).
- The deterministic merge/caps are unchanged; this is prompt + signals only.
