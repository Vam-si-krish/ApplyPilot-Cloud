# Devlog — Day 8 (2026-07-02) · START HERE for the new session

## ✅ Shipped this session: ATS-style match score v2 (ADR 0053)
The user's ask: the computed (non-AI) match % was useless as a first filter over a 200–400-job
fetch — research how ATS software compares résumé↔JD and make it a score worth filtering on.
**Explicit constraint: the AI fit scoring (`lib/scoring.ts`, SCORE_PROMPT, scoreRunner LLM path)
is untouched.** The new score is layer 1; AI stays the judgment.

### What landed
- **`lib/prefilter.ts` rewritten** (v1 IDF primitives kept as one component):
  55% skills (curated alias lexicon + Settings→Skills; required ×1.6 / nice-to-have ×0.6 /
  in-title ×1.5 / frequency boost) + 15% title alignment + 30% IDF keyword coverage,
  − penalties (years gap ≤ −15, required advanced degree −8), clearance/citizenship → capped at 5.
  HTML stripped before tokenizing (v1 scored raw HTML — a big source of its noise).
- **Migration 0033** (applied to live DB): `jobs.prefilter_breakdown jsonb` — component scores,
  matched/missing skills, penalty flags.
- **Webhook** stores score + breakdown at ingestion; **`POST /api/jobs/recompute-match`** re-scores
  all non-archived jobs (pure CPU, no LLM) after résumé/skills changes.
- **UI:** gauge "ATS NN%" badge on Jobs rows (MatchBadge); Sort: AI fit / ATS match; ATS-match
  filter in More filters (incl. "Weak match < 40%" for the delete pass); "Recompute ATS match"
  header button; JobDetails shows the full breakdown; JobsLegend + Settings copy updated.
- **Tests:** `lib/prefilter.test.ts` rewritten (22 tests). `npm run typecheck` + full suite green.

### Live validation (all 2,024 jobs re-scored via local script)
Distribution: 110 ≥65 · 747 at 40–64 · 1,083 at 20–39 · 84 <20. Vs existing AI fit scores: avg ATS
monotone in fit (fit 1 → 19.6, fit 10 → 78), corr ≈ 0.54. Threshold simulation: cutting <35% removes
~73% of fit≤5 jobs, loses ~16% of fit≥8; <25% loses only ~11%. Top scores = React/JS/Next.js roles;
bottom = clearance-restricted (capped 5) and off-stack (Java) roles. Looks right.

### Research trail (for future tuning)
Jobscan match-rate docs (hard skills ≫ title > education > other keywords; frequency matters);
ats-screener (MIT, TS — taxonomy + synonyms + required/preferred sections + per-ATS weights);
srbhr/Resume-Matcher (simpler than our v1); embeddings rejected again (spread/explainability).

## Open questions / follow-ups
- **Not deployed yet** — Netlify deploy + the daily fetch will use the new scorer automatically.
  The existing rows are already re-scored directly in the DB.
- Settings `prefilter_threshold` default is still 30 from ADR 0008; with the new metric 30–35 is
  a sensible gate. User should eyeball a few 30–45% jobs before turning the auto-filter on.
- Lexicon is software/data-centric; extend `SKILL_GROUPS` (or just Settings→Skills, which
  auto-registers) if fetches broaden.
- The user filters with "Weak match < 40%" + select-all + Delete selected as the manual first pass.
