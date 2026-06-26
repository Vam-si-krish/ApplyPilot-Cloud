# ADR 0040 — Categorized Boston-area location suggestions (target quieter tech belts)

**Status:** accepted · **Date:** 2026-06-26

## Context
The Settings location library seeds from a flat list of 11 one-click suggestions (mostly big cities:
Boston, Cambridge, Worcester, Providence, NYC…). The user's strategy is to **target less-visible suburban
tech hubs** around Boston — postings listed as e.g. "Marlborough, MA" or "Westford, MA" draw far fewer
applicants than "Boston, MA," improving the odds of getting shortlisted — and they wanted those surfaced as
selectable suggestions/categories so they can add them and run the fetch.

The Greater Boston tech geography is well-established (Route 128 / I-495 "America's Technology Highway"):
Waltham, Burlington, Natick (MathWorks), Westford (Red Hat/NetScout/Cisco), Marlborough, Woburn, Hopkinton
(Dell/EMC), Framingham, Bedford, Lexington, Chelmsford, Andover, etc. — all real software/tech employers and
recognized LinkedIn search locations.

## Decision
- Replace the flat `LOCATION_SUGGESTIONS` with **`LOCATION_SUGGESTION_GROUPS`** — ~45 cities grouped by area:
  Boston core (most competition) · Route 128 inner suburbs · I-495 / MetroWest (quieter) · North & Merrimack
  Valley (quieter) · South of Boston · Worcester & NH border · Broader/remote. Quieter, lower-competition
  belts are labeled as such so they're easy to spot.
- `LibraryPicker` gains an optional **`suggestionGroups`** prop: when provided it renders labeled groups of
  dashed "add" chips instead of the flat `suggestions` row (keywords/skills keep the flat row). Clicking a
  chip adds the city to the saved **and** selected locations, exactly like before; already-added cities are
  hidden per group.
- No schema or pipeline change — these are just seed suggestions. Selected locations flow through the
  existing fetch unchanged (each becomes an Apify/LinkedIn search location).

## Consequences
- The user can one-click-assemble a spread of quieter suburban locations and run the pipeline against them,
  surfacing suburban-office postings that don't show under "Boston."
- Suggestions are curated data, easy to extend; the grouped UI is reusable for any future categorized library.
- Caveat: very small towns return sparse LinkedIn results and some suburban roles are still listed under
  "Boston"/"Greater Boston," so casting a few suburbs together works better than relying on one tiny town.

## Alternatives considered
- **Just expand the flat list** — rejected; ~45 ungrouped chips are hard to scan and hide the whole point
  (which areas are the quiet ones).
- **Per-group "Add all" button** — deferred; the parent's per-item `onAdd`/`patch` closure would need a
  batch handler to avoid stale-state adds. Individual chips are correct and simple for now.
