# ADR 0019 — Skill gate, fetch cap, and bulk-over-all-matching workflow

**Status:** accepted · **Date:** 2026-06-18 · **Builds on** [ADR 0018](0018-skill-match.md)

## Context
After adding skills (ADR 0018) a single run returned **700+ jobs**, all of which got AI-scored —
wasting tokens on jobs that don't match the user's skills. Three concrete problems:
1. **Token waste:** jobs with zero/low skill match still get an LLM fit score.
2. **No fetch limit:** results = `results_per_role × roles × locations`, which ballooned.
3. **Workflow / 300 cap:** the Jobs page hard-capped the list at 300 and "Select all" only selected
   visible rows — so the user couldn't see all 700 or bulk-assess company quality across the full set,
   and there was no way to find the not-yet-assessed jobs.

**Research:** the cheap_scraper actor has **no skill filter** — `resumeKeywords` only *scores*, and every
other filter explicitly "still counts toward billing." So skill filtering must be done **locally**.

## Decision
- **Skill gate (token saver).** New `settings.min_skill_match` (0–100, default 0). In the **auto**
  pipeline (`/api/score-batch`), jobs with `skill_match_score < min_skill_match` are marked `filtered`
  (no LLM call), mirroring the prefilter gate. Null score (no skills / other actor) passes. Manual
  "Score selected" bypasses it (explicit pick wins). `1` ≈ "require at least one of my skills".
- **Fetch cap.** New `settings.max_jobs_per_run` (0 = off). Caps the actor `maxItems`
  (`min(results×combos, max_jobs_per_run)`, still floored to 150). Stops 700-job blowups at the source.
- **Bulk over all matching.** `/api/jobs?idsOnly=true` returns **every** id matching the current filter
  (not just the page). The Jobs page gains a **"Select all N matching"** action; bulk score/assess now
  operate on the full selection (the endpoints resolve jobs by id, so off-page ids work). Added a
  **skill-match filter** and a **"Company: Not assessed"** filter (`company_tier IS NULL`), plus
  **Load more** pagination (the list was silently capped at 300).

## Consequences
- The daily run only spends AI tokens on jobs that clear the skill gate (and the existing prefilter /
  recommended thresholds) — the core ask.
- The user can filter to *unassessed* high-scorers and **Select all N matching → Assess companies**
  across the whole set, not just the visible 300. (Bulk assess still chunks 5/req; a very large set is
  slow but correct. Auto-assess after scoring remains the hands-off path.)
- `min_skill_match` only bites when skills are set and the actor returns a score; otherwise inert.

## Alternatives considered
- **Actor-side skill filter** — not available (research above); would still bill anyway.
- **LinkedIn boolean keyword** (`role AND (React OR …)`) to filter at the source — possible but brittle;
  deferred. The local gate is reliable and also saves the bigger cost (LLM), not the cents of fetch.
- **Drop non-matching jobs at insert** — rejected: marking `filtered` keeps them inspectable under the
  Filtered tab, consistent with the prefilter.
