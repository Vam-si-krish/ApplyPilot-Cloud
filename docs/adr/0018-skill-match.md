# ADR 0018 — Skill-match scoring via the actor's resumeKeywords

**Status:** accepted · **Date:** 2026-06-18

## Context
The user wants to gauge jobs by their skills ("React is my primary skill"). The `cheap_scraper`
LinkedIn actor has a native `resumeKeywords` input: you pass a list of skills (each `keyword` + optional
`aliases`), and it tags **every returned job** with `matchedKeywords`, `unmatchedKeywords`, and
`keywordMatchScorePercentage` (0–100). It does **not** filter the search — it annotates each result.

The user chose "**score every job by skill match**" (not a hard filter, not just a search term). This is
a free, no-LLM signal, distinct from the AI fit score (1–10) and the IDF keyword pre-screen (ADR 0008).

## Decision
- **Schema (migration 0014):** `settings.skills text[]`; `jobs.skill_match_score int` (0–100),
  `matched_skills text[]`, `unmatched_skills text[]`.
- **Fetch (`lib/apify.ts`):** `buildLinkedInInput` passes `resumeKeywords: skills.map(s => ({ keyword: s }))`.
  `mapDatasetItemToJob` reads `keywordMatchScorePercentage` (clamped/rounded 0–100) and
  `matchedKeywords`/`unmatchedKeywords` into the new fields; they flow into the existing webhook upsert
  (which spreads MappedJob), so no insert change is needed. Null when the actor doesn't return them
  (e.g. no skills set, or a different actor).
- **UI:** a Settings "Skills" editor (chips + suggestions); a `SkillMatchBadge` (🎯 NN%, colored by
  strength) on each Jobs row; matched/unmatched skills in the shared `JobDetails` panel.

## Consequences
- Per-job skill fit with zero extra cost or LLM calls; complements (doesn't replace) the AI fit score.
- Specific to the `cheap_scraper` actor's output; other actors simply leave the fields null.
- Display-only for now. A sort/filter "by skill match" is a natural follow-up (the column exists), but
  was kept out of this change to bound scope — the user picked score-and-show.

## Alternatives considered
- **Hard filter on the skill** — offered; the user chose scoring over filtering (keeps visibility of all
  jobs, just ranked by fit).
- **Skill as a search keyword** — works already (add it to the keyword library) but narrows *what* is
  fetched rather than scoring fit; orthogonal, both can be used.
- **Aliases in the UI** — `resumeKeywords` supports `aliases` (TS→TypeScript). Deferred: v1 sends the
  bare keyword; aliases can be added later (e.g. comma syntax) without a schema change.
