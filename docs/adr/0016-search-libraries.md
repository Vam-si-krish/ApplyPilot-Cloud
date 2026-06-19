# ADR 0016 — Saved search libraries (select roles/locations, don't re-type)

**Status:** accepted · **Date:** 2026-06-18

## Context
Roles and locations were free-form tag inputs: to change what a run targeted, the user had to type or
delete tags every time. They want a **persistent library** of roles and locations that always stays,
and to just **select** which subset to search on a given run (e.g. keep Boston, New York, Providence,
neighboring states all saved, toggle on only what's needed today).

## Decision
Separate the saved library from the active selection.

- **Schema (migration 0013):** add `keyword_options text[]` and `location_options text[]` (the saved
  libraries). `keywords` / `locations` keep their meaning — the **active selection** the run uses, now
  a subset of the options. The migration **seeds the options from the current keywords/locations** so
  nothing is lost.
- **No change to the run:** `planRuns` / scoring still read `settings.keywords` and
  `settings.locations` (the selection). The library is purely additive.
- **UI (`LibraryPicker`):** each option is a chip — selected chips are highlighted (and are what gets
  searched); click toggles selection; the × removes an option from the library entirely. New options
  are added via an input or one-click **suggestions** (a starter set of Northeast/New-England
  locations + common eng roles). Removing a location also prunes its `location_limits` entry (ADR 0015).
- **API:** `keyword_options` / `location_options` validated and persisted (de-duped); selection arrays
  unchanged.

## Consequences
- Editing a search is now select/deselect, not retype — the user's stated pain point.
- The active selection can be empty if the user deselects everything; the UI shows an "N of M selected"
  count to make that visible. (A run with no roles/locations is a no-op-ish search; not hard-blocked.)
- Backward compatible: existing keywords/locations seed the libraries; old clients that send only
  `keywords`/`locations` still work.

## Alternatives considered
- **One array of `{value, active}` objects** — rejected: changes the type `keywords`/`locations`
  everywhere (apify, scoring) for no functional gain; the parallel-array approach keeps the run code
  untouched.
- **Hard-validate selection ⊆ options** — unnecessary; the UI only ever selects from options, and the
  API de-dupes. Keeping it lenient avoids spurious save failures.
