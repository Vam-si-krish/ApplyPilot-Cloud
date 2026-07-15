# DAY 24 — 2026-07-15 (User-defined résumé sections)

## Architecture review

- Kept the feature inside the existing user-owned `profile.base_resume` and
  `applications.tailored_resume` JSONB rows. No table, credential, service endpoint, or
  storage namespace changed; forced RLS continues to provide the account boundary.
- Traced the document across the browser, Next routes, scoring/assistant serializers,
  worker tailoring/condensing, change review, semantic HTML, and the one-page renderer.
- Recorded the additive shape and AI anchoring policy in ADR 0085. App and worker copies
  normalize old documents that do not yet have `customSections`.

## Implementation

- Added ordered, user-named custom sections with generic entries for Additional
  Experience, Certifications, Leadership, Publications, Awards, and similar content.
- The shared Base/tailored editor supports section and entry add/edit/delete controls;
  the tailored review view shows custom sections and word-level bullet changes.
- Resume parsing, scoring text, ApplyBuddy grounding, tailoring length budgets, merge
  guards, condensing, PDF templates, and deterministic overflow trimming all include the
  new content. The AI can rewrite custom bullets but cannot change user-entered custom
  facts or add more bullet slots than the base résumé contains.
- Added the worker `/version` feature marker `custom-resume-sections`; no migration or
  environment change is required.

## Verification

- App regression suite: 200 passed, 9 credentialed evals skipped after rebasing onto the
  latest Candidate Profile/AI-policy and shared résumé-paper architecture.
- Worker regression suite: 16 passed, including normalization, HTML escaping/rendering,
  fact anchoring, and highlight caps for custom sections.
- Backend gateway/storage regression suite: 2 passed after restoring this checkout's
  lockfile-declared local test dependencies.
- TypeScript typecheck passed.
- Browser fixture on the final white-paper editor verified two existing custom sections,
  actually added a third section in local unsaved state, and showed no horizontal overflow
  at 1440px. Inspection also caught and fixed uppercase custom-title clipping by giving the
  shared heading its full available width; the fixture was removed afterward.
- A real Puppeteer render of a résumé containing Additional Experience produced one PDF
  page (`tooLong=false`) and preserved the custom section in the rendered document.
- The 33-page production build and the standalone TypeScript check both passed against
  the final rebased tree. Final documentation check passed with 119 Markdown files and
  79 ADRs.
- Pushed feature commit `c13d04f`, fast-forwarded the clean server checkout, and restarted
  `com.jobpilotmulti.worker`. Both the local worker and the external gateway returned a
  healthy browser and advertised `custom-resume-sections` from commit `c13d04f`.
