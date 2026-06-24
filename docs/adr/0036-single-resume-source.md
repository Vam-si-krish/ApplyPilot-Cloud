# ADR 0036 — One résumé: the structured base résumé is the single source

## Status
Accepted (2026-06-23)

## Context
There were two résumés on the `profile` row, and they drifted:
- `resume_text` (plain text, edited on the Profile page) → **fit scoring**, the **Assistant**,
  and the prefilter (ADR 0008). It was also the input parsed once into…
- `base_resume` (structured JSON Resume, edited under Tailor & Apply → Base résumé) → **tailoring**
  and **cover letters** (ADR 0035).

Because `base_resume` was a parse-once derivative and then hand-edited independently, edits to one
were invisible to the other: adding LinkedIn/GitHub links or fixing a role in the structured editor
never reached the scorer; editing the Profile text never reached tailoring. This silent divergence
was a recurring source of "why doesn't X reflect my change?" The user asked for one place the résumé
lives, with everything reading it.

## Decision
Make the **structured `base_resume` the single source of truth**; everything derives from it.

- **Scoring/prefilter** now call `getScoringResumeText()`, which serializes `base_resume` to
  recruiter-readable text via the existing `resumeToText()` (the same serializer that already scores
  the *tailored* résumé, ADR 0029). It falls back to the legacy `resume_text` only when no base
  résumé exists yet — a transition safety net, not a second source.
- **Assistant** reads the serialized `base_resume` for the résumé fact (fallback `resume_text`); its
  other profile blobs (`assistant_profile`, work auth, comp, etc.) stay in Supabase, unchanged.
- **Profile page** drops the "Résumé text" tab; `resume_text` is removed from the profile API
  allow-list. The **Base résumé** editor (Tailor & Apply) is the only place to edit the résumé.
- The `resume_text` **column is kept** (non-destructive; still the fallback and preserves data); the
  one-time "Rebuild from résumé text" parse path is retired along with its UI button. The
  `/api/base-resume/parse` route is left in place but unwired.

## Consequences
- No more drift: one edit, consistent everywhere (scoring, tailoring, cover letters, assistant).
- **Scoring input changes** from the user's original prose to a structured serialization of
  `base_resume`. Verified after the switch: typecheck, the eval suite, and the build stay green, and
  the live profile has a populated base résumé (so scoring uses it, not the fallback). If a base
  résumé is *thinner* than the old prose, the scorer sees less — completeness of the Base résumé now
  matters more.
- **No paste-a-résumé bootstrap** anymore: a brand-new résumé is entered/edited structurally. If that
  proves painful, a follow-up could add an inline "import from pasted text" *inside* the Base résumé
  editor (still one stored source) — deferred per the user's "remove it entirely" choice.
- App-side only (no migration, no worker change) → ships on the next deploy.
