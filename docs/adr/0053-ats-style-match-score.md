# ADR 0053 — ATS-style match score as the first filter (replaces plain IDF coverage)

**Status:** accepted · **Date:** 2026-07-02 · **Supersedes the metric of:** ADR 0008 (keeps its wiring)

## Context
The computed (non-AI) match % from ADR 0008 — IDF-weighted keyword coverage — was the user's first
look at a 200–400-job fetch, and it wasn't good enough to act on: scores clustered low, treated all
terms as equally meaningful skills, scored raw HTML (tags and class names counted as words), ignored
the job title, and knew nothing about must-haves, years of experience, or clearance walls. The user's
intended workflow is: **fetch → trust the local match % as the first filter → delete weak matches →
AI-score the survivors** (the AI fit score, `lib/scoring.ts`, is untouched by this change and remains
the real judgment).

## Research
How real ATS/scanner products compute a match (Jobscan's published match-rate docs; enterprise ATS
write-ups) and how popular open-source implementations do it:
- **Jobscan-style match rate:** hard skills dominate; job title and education factor in; skill
  *frequency* in the JD matters; "other keywords" have low impact.
- **ats-screener** (MIT, github.com/sunnypatell/ats-screener): per-vendor profiles with weighted
  components; skills extracted via taxonomy + n-grams; synonym canonicalization (k8s→kubernetes);
  required vs preferred section categorization; experience/education detection. Resume-quality
  components (formatting, sections) exist there but are constant for our one-résumé use case.
- **srbhr/Resume-Matcher:** keyword extraction + match % — simpler than what we already had.
- Embeddings/cosine similarity (eristavi/CV-Matcher): rejected again — poor score spread for
  ranking, needs an API, and is no more explainable.

## Decision — `lib/prefilter.ts` v2, same wiring, new metric
Score = **55% skills** (weighted coverage of JD-extracted skills: curated alias lexicon + the user's
Settings→Skills; required-section ×1.6, nice-to-have ×0.6, in-title ×1.5, frequency up to ×1.75)
+ **15% title** (job-title ↔ résumé role alignment, level words stripped, developer≈engineer)
+ **30% keywords** (the ADR 0008 IDF coverage, kept for vocabulary the lexicon doesn't know),
− penalties (years-of-experience gap up to −15, required advanced degree −8), and a **hard cap of 5**
for clearance/citizenship-restricted postings (mirrors the LLM scorer's hard block, ADR 0038).
HTML is stripped (block tags → newlines) before any tokenization. A null component redistributes its
weight. Null score (empty résumé) still means "pass".

- Same column (`prefilter_score` 0–100), same scoring gate (`scoreRunner`), same Settings threshold.
- New `jobs.prefilter_breakdown` jsonb (migration 0033): per-component scores, matched/missing
  skills, penalty flags — rendered in JobDetails so the % is explainable.
- **UI:** ATS badge on every Jobs row; "Sort: ATS match %"; ATS-match filter (incl. "Weak match
  < 40%" for the delete pass); "Recompute ATS match" button → `POST /api/jobs/recompute-match`
  (pure CPU, re-scores all non-archived jobs after résumé/skills/algorithm changes).

## Validation (live DB, 2,024 jobs re-scored on 2026-07-02)
Spread instead of a cluster: 110 jobs ≥65, 747 at 40–64, 1,167 <40. Against existing AI fit scores:
avg ATS rises monotonically with every fit band (fit 1 → 19.6 avg ATS; fit 10 → 78), corr ≈ 0.54.
Deleting below 35% would have removed ~73% of fit≤5 jobs while losing ~16% of fit≥8 — the intended
first-filter trade-off; below 25% loses only ~11% of good jobs.

## Addendum (same day) — tailored-résumé ATS check in Tailor & Apply
The user asked to re-check the score with the AI-tailored résumé. The *LLM* re-score of tailored
résumés was dropped deliberately (ADR 0050) and stays dropped; this is the local ATS scorer instead —
the Jobscan loop (tailor → rescan → confirm gaps closed), free and instant:
- `POST /api/applications/ats-check { id }` scores the tailored résumé (`resumeToText`) against the
  application's job; the base résumé is scored in the same call so before→after is method-identical.
  Stored in `applications.tailored_match_score` / `tailored_match_breakdown` (migration 0034).
- **Single-job comparability fix:** batch-IDF is degenerate on tiny batches (terms shared with the
  résumé get weight 0), so below 5 jobs the keywords component is null and its weight redistributes
  to skills/title (`AtsMatchBreakdown.keywords` is now nullable).
- **UI:** auto-runs after generation; a gauge button on each Tailor & Apply row shows the tailored
  % (click to re-check, e.g. after manual edits); tooltip lists still-missing skills; the toast shows
  "base% → tailored%".

## Consequences
- The old threshold semantics changed (scores now run higher and mean more): 30–35% is a sensible
  gate where the old default 30% was aggressive for IDF coverage.
- The lexicon is software/data-centric by design; unusual stacks still score via the user's
  Settings→Skills (auto-registered as lexicon entries) and the 30% keywords component.
- A cheap filter still mislabels some good jobs (~1 in 6 at a 35% cut) — it decides what gets
  *deleted or deferred*, never fabricates a fit; the AI score stays the judgment (CLAUDE.md rule).
