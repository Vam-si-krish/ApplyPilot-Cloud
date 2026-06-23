# ADR 0031 — Strict one-page tailoring: deterministic caps + AI-condense loop, patch output, prompt caching

## Status
Accepted (2026-06-23)

## Context
Tailored résumés kept spilling onto a **second page** despite the prompt telling the
model to stay net-neutral. Two controls already existed and neither closed the gap:

1. `capHighlights` (ADR 0029) caps the **number** of bullets per role to the base count.
2. The worker renderer (ADR 0024 Phase 3) shrinks the font `--scale` down to a readable
   floor (~9pt); if content still overflows at the floor it gave up and emitted a
   2-page PDF with `tooLong: true`.

The hole: `capHighlights` caps bullet **count**, not **size**, and nothing capped the
summary or skills at all. Meanwhile `TAILOR_PROMPT` actively invited growth — "add
plausible detail, metrics… describe in depth" turned one-line bullets into 2–3 line
bullets; the summary was taken verbatim; and a line literally told the model *"skills…
don't push it to a second page"* (false — skills wrap). Content grew in **characters**
while bullet-count stayed flat, the font bottomed out at the floor, and it spilled.

Telling the model "harder" can't fix this: an LLM can't see the rendered page or count
lines. The component that *can* measure the page (the renderer, via real `pdf-lib` page
count) must drive the outcome.

Separately: the tailoring call (`claude-sonnet-4-6`, ~4000 output tokens) regenerated the
**whole** résumé JSON — name, contact, education, company names, titles, dates — all of
which `mergeTailored` discards and restores from the base. And `chatAnthropic` sent no
`cache_control`, so the static system prompt + base résumé were billed at full price on
every job in a tailoring session.

## Decision
Four changes (the tailoring code is duplicated by hand in `lib/*` and `resume-worker/*`;
both copies were updated identically).

**1. Deterministic one-page caps (always, in the merge).** `mergeTailored` now also:
- hard-caps the **summary** length to `max(baseLen × 1.15, 320)` chars (word-boundary trim);
- caps **total skill keywords** to `max(baseCount + 6, ceil(baseCount × 1.4))`;
- keeps the existing per-role/project bullet-**count** cap.
These are the "safe" caps (no mid-sentence mangling) and run before anything else.

**2. AI-condense loop + deterministic backstop (the guarantee).** The worker now renders
to a *guaranteed* one page (`renderResumeToOnePage`): render → if it would overflow at the
readable floor, ask the model to **condense** (up to 2 passes — the AI chooses what to
shorten/drop, preferred over a blind truncation) → re-render. A final deterministic
backstop then drops the least-important bullet (last highlight of the longest section)
until it fits, so it **can never ship 2 pages** even if the LLM is unavailable. A résumé
shortened to fit is persisted back to `tailored_resume` (so the on-screen copy matches the
PDF) and its stale tailored fit score is cleared.

**3. Patch-shaped output (token cut).** `TAILOR_PROMPT` now asks for ONLY the fields the
merge keeps — `basics.summary`/`label`, per-role/project `highlights` (with `name` as an
alignment key), `skills`, and `_changes` — omitting identity, contact, titles, dates,
locations, and education entirely (the merge restores them from the base regardless). The
parsing pipeline is unchanged: `normalizeResume` already tolerates partial JSON and
`mergeTailored` already ignores the omitted fields, so this is a prompt-only change that
roughly halves output tokens and reduces drift on anchored facts.

**4. Prompt caching (input cut).** `ChatMessage.content` may now be `string | ContentPart[]`
where a part can be marked `cache: true`. The Anthropic client attaches
`cache_control: {type:"ephemeral"}` to those parts; every other provider just concatenates
the text (no behavior change). `buildTailorMessages` puts the **system prompt + base résumé
+ length budget** as a cached prefix and the **per-job description + signals** as the
volatile tail. Across a tailoring session the prefix is a cache read (~0.1× input). Sonnet
4.6 needs a ≥2048-token prefix to cache (system + a real résumé clears this; a sparse
résumé silently won't — no error). The prompt's per-section length budget is derived only
from the base, so it stays inside the cached prefix.

## Consequences
- The PDF is **strictly one page**. `tooLong` is now effectively always false (the backstop
  guarantees fit); it's retained only as a last-resort signal.
- The condense loop costs at most ~2 extra short LLM calls, and only when a résumé would
  otherwise overflow — most fit on the first render.
- Output tokens per tailoring call drop ~half (patch output); repeated input (system + base)
  is cached across a session. Net: meaningfully cheaper tailoring, addressing the token ask.
- The fit rubric (ADR 0022) and the anchoring discipline (ADR 0026 — employers/titles/dates/
  education restored from base) are unchanged. Caps and condensing only ever **shorten**;
  they never invent or alter verifiable facts.
- **Worker redeploy required** — the condense loop and `renderResumeToOnePage` live on the
  always-on worker. No schema/migration changes. Default TTL caching (5-min) is used to avoid
  any extended-TTL header dependency; a 1-hour TTL is a possible future tweak if review gaps
  routinely exceed 5 minutes.
