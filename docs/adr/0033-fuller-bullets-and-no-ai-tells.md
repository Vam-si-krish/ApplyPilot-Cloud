# ADR 0033 — Fuller résumé bullets + human voice (no AI tells)

## Status
Accepted (2026-06-23)

## Context
After ADR 0031 guaranteed a one-page résumé, the generated PDF looked **weak**: every
bullet was forced to a single ~120-char line, so the page came out half-empty (large
whitespace below Education) with thin, sparse points. The prompt also produced AI
giveaways — em-dashes (`—`) used as punctuation and buzzword filler ("leverage",
"seamless", "robust", "spearhead", etc.) — which read as machine-written and hurt the
candidate.

The one-page guarantee now lives downstream (render auto-fit → AI condense → deterministic
backstop, ADR 0031), so the prompt no longer needs to enforce length by crushing bullets.
That freed us to make bullets *fuller* without risking overflow.

## Decision
Tune the tailoring prompt (both synced copies — `lib/resumeTailor.ts` and
`resume-worker/tailor.js`) and add a deterministic safety net:

1. **Fuller bullets, same count.** The `LENGTH` section now asks for SUBSTANTIAL bullets
   (~2 lines, ~180–210 chars: scope/context + action + concrete tech + quantified result)
   that *fill* the page, while keeping the bullet **count** unchanged (still capped to the
   base count in `mergeTailored`). Removed the old "keep every bullet to one line / a
   wrapped bullet costs two" guidance.
2. **A "WRITE LIKE A HUMAN, NOT AN AI" section** (adapted from the assistant prompt):
   strong, *varied* past-tense action verbs; concrete + quantified; no vague "responsible
   for / worked on"; an explicit **ban on em-dashes**; and a banned-words list (leverage,
   utilize, robust, seamless, spearhead, synergy, facilitate, foster, elevate, navigate,
   landscape, "passionate about", "results-driven", the "not just X, but Y" construction…).
3. **Deterministic em-dash stripper (`cleanText`)** applied to every generated bullet and
   the summary in `mergeTailored` — an em-dash (U+2014) used as punctuation becomes a comma,
   regardless of what the model emits. Hyphens in compounds (cross-browser, real-time) and
   en-dashes in date ranges are untouched.
4. **Condense prompt softened** — when the page genuinely overflows, it now trims *just
   enough* (wordiest bullets / least-important clause) instead of crushing everything to a
   thin one-liner, and it carries the same em-dash/AI-tell ban.

## Consequences
- The résumé fills the page with substantive, quantified bullets and reads like a person
  wrote it; em-dashes are guaranteed gone (prompt + `cleanText` belt-and-suspenders).
- Bullet **count** and the anchored facts (employers/titles/dates/education, ADR 0026) are
  unchanged. The one-page guarantee (ADR 0031) still holds; fuller bullets just fill the
  previously-empty space, and the render only shrinks the font / condenses if they actually
  overflow.
- Prompt-and-code only; no schema/migration. Worker redeploy/restart required (the running
  worker was restarted under launchd so the change is live).
