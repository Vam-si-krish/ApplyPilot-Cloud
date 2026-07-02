# ADR 0057 — Duplicate-posting detection (multi-location blasts + daily reposts)

**Status:** accepted · **Date:** 2026-07-02

## Context
Employers blast one requisition across many locations (Deloitte × 12 metros in one fetch) and
re-post daily under fresh LinkedIn job ids — same company, same title, byte-identical description,
different URL every time. The jobs table de-dupes by URL only, so every copy inserted, cluttered
the list, and burned an LLM scoring call. Measured on the live DB before the fix: **~32% of all
rows were copies (640 exact / 705 loose) and 561 scoring calls had been spent re-scoring identical
text** — an ongoing daily cost, since reposts re-arrive with new URLs. Mass-posters like
DataAnnotation (200+ rows across "AI Trainer" titles) are the harvester version of the same pattern.

## Decision
- **Content fingerprint** (`lib/dedupe.ts` `jobContentKey`): md5 of company + title + HTML-stripped,
  case/whitespace-normalized description. Location deliberately excluded — it's the field reposts
  vary. ONE implementation, imported by ingestion, linking, and the backfill (migration 0036 adds
  `jobs.content_key` + `jobs.duplicate_of` + partial indexes; applied live).
- **Link at ingestion** (`linkDuplicateJobs` in `lib/db.ts`, called by the webhook after upsert):
  per key, the earliest still-unlinked row is the canonical; other unlinked rows get
  `duplicate_of`, and when the canonical is already scored, an unscored duplicate inherits the
  canonical's fit score/breakdown/reasoning verbatim and leaves the queue. This is a COPY of a real
  score for identical content — the rubric explicitly does not score location — so the
  "never fabricated" invariant holds; "one LLM call per job" becomes one call per unique posting.
- **Scoring loop** (`scoreJobRows`): a duplicate row copies its canonical's outcome (scored →
  copy; filtered → filtered) instead of calling the LLM; if the canonical is still unscored (same
  concurrent batch) it falls through and scores normally — no deadlocks. `getUnscoredBatch` orders
  canonicals first to make copies the common case.
- **UI**: the Jobs API hides `duplicate_of` rows — EXCEPT copies the user interacted with
  (applied / shortlisted / opened), which stay visible in their own right — and attaches
  `siblings` (id, location, url, status, applied) to each canonical. The row shows a "+N"
  location-pin chip; the expanded panel lists each location as an openable link, so applying to a
  specific metro's posting still works.
- **Backfill** (script, run 2026-07-02): keyed all 2,367 rows, linked 668 duplicates, 646 of which
  now carry scores; the remaining 18 copy automatically once their canonicals are scored.

## Consequences
- The working list shrank ~28% with zero information loss; future runs skip an LLM call for every
  duplicate (~30% of a typical fetch) — which also protects the Claude-subscription window.
- Duplicates rescored explicitly via "Score selected" in subscription-delegate mode bypass the
  copy path (worker /score-jobs doesn't know about duplicates) — acceptable: explicit selection is
  a deliberate override, and the batch/auto path (where volume lives) runs app-side.
- Near-duplicates with genuinely differing bodies (~9% of the loose estimate) still appear as
  separate rows — deliberate: same company+title alone can be different real reqs.
- If a canonical is deleted, `duplicate_of` nulls out (FK `on delete set null`) and the oldest
  surviving copy becomes the group's canonical on the next linking pass that touches its key.
