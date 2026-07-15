# ADR 0084 — Shared résumé-paper editor and review presentation

**Status:** accepted · **Date:** 2026-07-15 · **Builds on:** ADRs 0024 and 0053

## Context

The generated PDF was a polished white, single-column document, but the Base résumé editor
and tailored-résumé editor/review used a small dark card with low-contrast résumé text.
Users could edit every field and inspect word-level changes, yet the document was harder to
scan and did not resemble the artifact they would download. Styling had also drifted between
`ResumeFields` and `ResumeDiff`, including section order, education hierarchy, and mobile
date/location alignment.

The browser editor cannot become the source of truth for page fitting. The always-on worker
must continue to render and measure the final PDF because it owns Chromium, PDF page count,
condensing, and the deterministic one-page backstop.

## Decision

Introduce `components/ResumePaper.tsx` as the shared presentation boundary for editable and
read-only review states:

- render a centered white document on a dark workspace, with print-like margins, readable
  black text, stronger section rules, and a restrained document toolbar;
- match the worker PDF's section hierarchy: Summary, Technical Skills, Professional
  Experience, Projects, and Education, including degree-first education rows;
- preserve inline editing, add/remove controls, local draft behavior, and every existing
  `ResumeDoc` field. Editing affordances stay visually quiet until hover or focus;
- render tailoring additions and removals inside the same polished document using accessible
  green/red highlights, rather than switching to a code-like diff surface;
- reflow entry dates, locations, and metadata vertically on narrow screens. The on-screen
  page remains responsive rather than forcing a desktop-width document on phones.

The shared browser component is a close presentation preview, not a pixel-identical PDF or
a page-count guarantee. The selected PDF template, scale, condensing, and one-page fitting
remain exclusively in `resume-worker/templates.js` and `render.js`.

## Consequences

- Candidate Profile, Tailor & Apply editing, Tailor & Apply change review, and the manual
  generation editor share one recognizable résumé canvas and cannot drift independently.
- The application becomes easier to review without changing persistence, RLS, worker calls,
  tailoring behavior, or generated files.
- A browser document can be taller than one PDF page because controls and responsive reflow
  consume space; the downloaded/re-rendered PDF remains the final layout authority.

## Verification

- Authenticated Candidate Profile smoke checks at desktop and phone widths.
- Fixture-based visual inspection of realistic editable and tailored-diff documents at
  desktop and phone widths; the fixture route is removed before commit.
- App tests, TypeScript typecheck, production build, and documentation checks.
