# ADR 0022 — Scoring v2: weighted, must-have-aware rubric (+ contract flagging)

**Status:** accepted · **Date:** 2026-06-20 · **Retires the "frozen SCORE_PROMPT" rule of** CLAUDE.md

## Context
The user wants jobs rated *very well* and is fine spending more tokens. The original scorer was a
holistic 1–10 prompt copied verbatim from ApplyPilot-Lite (the project's "#1 frozen rule"). Research
into open-source résumé↔JD matchers (Resume-Matcher, LlamaFactoryAI CV-JD matcher, recent LLM-hiring
papers) shows consistently better, more explainable scoring from: a recruiter **persona**, an explicit
**weighted rubric**, a **must-have vs nice-to-have** split, **seniority/role awareness**, strict
**anti-hallucination**, and **structured per-dimension output**. Separately, the user worried the
company-assessment "red" tier might unfairly demote legitimate **contract/staffing** roles.

The user explicitly approved diverging from the Lite scorer.

## Decision
**Scorer v2 (`lib/scoring.ts`):** rewrite `SCORE_PROMPT` as a senior-recruiter, must-have-aware rubric.
- Phase 1 validation preserved (non-JD → 0; citizenship/clearance-required → 1).
- Phase 2 scores five weighted dimensions — must-have skills (0–40), experience & seniority (0–25),
  domain relevance (0–20), nice-to-haves (0–10), logistics (0–5) — then maps to 1–10 with a **hard
  gate: missing must-haves cap the score at ≤4**. Seniority over/under-qualification penalized.
- Output adds `EMPLOYMENT`, `SENIORITY`, `BREAKDOWN`, `MISSING` lines; `parseScoreResponse` parses them
  (clamped, all optional → old responses still parse). `scoreJob` uses `max_tokens: 1000`,
  `temperature: 0.1`. **Still one call/job; error → score 0, never fabricated.**
- **Persisted** (migration 0017): `jobs.score_breakdown jsonb` (sub-scores + missing + seniority) and
  `jobs.employment_type`. Shown in `JobDetails` (fit breakdown + missing must-haves) and as a row badge.

**Contract handling:**
- `employment_type` (full_time | contract | internship | unknown) comes from the same scoring call.
- Jobs page: a **Contract** badge + an **employment-type filter**, so contract roles are *surfaced and
  reviewable*, never silently dropped (the user can eyeball them or run company-assessment on them).
- `COMPANY_PROMPT` updated: a legit staffing firm / contract role is **not** `low`; `low` is reserved
  for true time-wasters (lead-gen, résumé-upsell, data-harvesting, shell, fake reposts). Employment
  type ≠ legitimacy.

## Consequences
- Richer, explainable scores; the breakdown shows *why* a job scored what it did and what must-haves
  are missing. More tokens per job (acceptable per the user).
- Eval cases keep the same 0–10 bands and directional semantics, so they remain the regression net.
- The Lite "byte-for-byte" invariant is retired; CLAUDE.md updated. The non-fabrication + one-call
  discipline remains.

## Alternatives considered
- **Keep the holistic prompt** — rejected; the user asked for a meaningful quality jump.
- **Separate LLM call for employment type** — unnecessary; the scorer already reads the full JD.
- **Auto-hide/skip contract roles** — rejected; the user wants to review them, so flag + filter instead.
