# ADR 0051 — Produce the cover letter in the same call as tailoring

**Status:** accepted · **Date:** 2026-07-01 · relates to [ADR 0027](0027-tailoring-on-worker.md), [ADR 0035](0035-cover-letters.md)

## Context
Tailoring and cover-letter writing were two separate LLM calls that each sent the base résumé +
the same job description:
- **Tailor** ([resume-worker/tailor.js](../../resume-worker/tailor.js)): base résumé (cached prefix
  on the subscription path) + JD (~12k chars) → JSON résumé. `maxTokens: 4000`.
- **Cover letter** ([resume-worker/coverLetter.js](../../resume-worker/coverLetter.js)): a compact
  résumé view (no cache) + JD (~8k chars) → prose. `maxTokens: 1200`. A *separate* manual button.

The user generates a cover letter for **every** job they tailor (e.g. 30 jobs → 30 letters), so in
practice the two calls are 1:1. That means the job description and résumé are sent **twice per job**,
and the cover-letter call shares no cache with the tailor call — pure duplication, ~30× over a batch.
On the subscription/Agent-SDK path each call is also a separate subprocess round-trip (the slow part).

## Decision
Have the single tailoring call **also** return the cover letter, so one round-trip produces both.

- `TAILOR_PROMPT` gains a `cover_letter` string field (with the ADR 0035 letter style + truthfulness
  rules folded in: 3 paragraphs, "Dear Hiring Manager," → "Sincerely," + name, no AI-tell, no em-dash).
- `tailorResume` raises `maxTokens` 4000 → 5200 so the ~350-word letter never crowds the résumé
  budget (the résumé stays the priority), and returns `{ resume, changes, coverLetter }`.
  `coverLetter` is the letter run through the existing `extractLetter` cleanup, or **`null`** if the
  model omitted it or it fails the "must contain 'Sincerely'" / length check. `normalizeResume`
  already whitelists résumé fields, so `cover_letter`/`_changes` never leak into the résumé.
- The worker (`runFullPipeline` for the nightly queue, and `/tailor` for manual generate) renders +
  saves the embedded letter via a shared `saveEmbeddedCoverLetter` — **no extra LLM call**, reusing
  `renderCoverLetterPdf` + the same `${id}-cover.pdf` path and DB fields as the standalone route.
- **Fallback preserved:** if `coverLetter` is null (or its render fails), the résumé is still saved
  and nothing else happens — the standalone `POST /cover-letter` button remains the way to generate
  or regenerate a letter. So the merge is a *fast path*, never a new single point of failure.

## Consequences
- One LLM call + one JD send per job instead of two — for a user who always writes a cover letter,
  that's roughly halving the cover-letter cost and round-trips across a batch. Most impactful on the
  token-metered Claude subscription.
- Résumé quality is protected: separate parse (JSON résumé vs. the letter string), a raised token
  budget so neither truncates, and a null-safe extractor that can't fail the résumé.
- **Worker redeploy required** — this is entirely worker-side (`tailor.js`, `coverLetter.js` export,
  `server.js`). Until redeploy, the old worker tailors without a letter and the standalone button is
  used as before (no breakage).
- Only the **worker** tailorer changed; the app-side `lib/resumeTailor.ts` (the "paste a JD" manual
  flow) is unchanged and does not embed a cover letter.
- Regeneration of just the letter (different tone, retry) still uses the standalone path.
