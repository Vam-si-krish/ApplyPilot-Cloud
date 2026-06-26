# ADR 0039 — Re-scoring already-scored jobs is gated behind a Settings toggle

**Status:** accepted · **Date:** 2026-06-26

## Context
The manual **Score selected** action on the Jobs tab (`/api/score-selected`) previously **skipped**
already-scored jobs entirely — only `unscored`/`filtered` rows were sent to the LLM. So there was no way
to deliberately **re-assess** a job's score, but also no risk of accidentally overwriting scores.

The user wants the *ability* to re-score an already-scored job, but is worried about **accidentally**
triggering it (re-scoring overwrites the existing `fit_score`/`breakdown` and spends one LLM call per
job). A single button that always re-scores everything selected is too easy to fire by mistake.

## Decision
Add a boolean setting **`allow_rescore`** (default **false**) that unlocks re-scoring:

- **Migration 0028:** `settings.allow_rescore boolean not null default false`.
- **`/api/score-selected`** reads it: OFF → unchanged (score only `unscored`/`filtered`, skip the rest);
  ON → `toScore = rows` (re-score every picked job, overwriting). The selection still bypasses the
  pre-filter as before.
- **Settings → Re-scoring**: an amber toggle "Allow re-scoring already-scored jobs" with a note to flip it
  on, save, re-score, then flip it back off. Persisted on Save (not live), matching the user's flow.
- **Jobs tab feedback** so the unlocked state is never silent: an amber banner ("Re-scoring is ON … turn
  it off in Settings") and the bulk button switches **Score selected → Re-score selected** (amber) when
  the gate is on. The page re-reads the flag on mount (navigating Settings → Jobs remounts it).

## Consequences
- Re-scoring is now possible but **deliberate**: it takes a Settings change + Save before a click can
  overwrite scores, and the active state is visible wherever the trigger lives.
- Default behaviour is unchanged for everyone who never flips the toggle (safe by default).
- The automatic daily scorer (`score-batch`) is untouched — it only ever scores unscored jobs; this gate
  is purely for the manual selection path.

## Alternatives considered
- **A confirm() dialog on re-score** — rejected; easy to click through, and doesn't give a persistent,
  visible "armed" state.
- **Always re-score selected** — rejected; that's exactly the accidental-overwrite footgun the user flagged.
- **Per-click "include already-scored" checkbox in the toolbar** — viable, but the user specifically asked
  for a Settings toggle they arm deliberately, which also reads as a clear safety state.
