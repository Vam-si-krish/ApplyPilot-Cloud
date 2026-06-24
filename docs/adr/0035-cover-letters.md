# ADR 0035 — Per-application cover letters

## Status
Accepted (2026-06-23)

## Context
Tailor & Apply produced a tailored résumé PDF per application, but many roles also want a
cover letter. The user wanted to generate one per company and download it from the same
section — i.e. two downloads on a row: résumé and cover letter. A cover letter is one more
LLM call plus a PDF render, the same shape as résumé tailoring, so the question was how much
to reuse vs. add.

## Decision
Mirror the résumé architecture exactly, as an **independent, on-demand** artifact.

- **DB (migration 0026)** adds three nullable columns to `applications`: `cover_letter` (the
  generated text — also lets us re-render later), `cover_letter_pdf_path` (the rendered PDF in
  the private `resumes` bucket, stored as `<id>-cover.pdf`), and `cover_letter_error` (last
  failure, for the UI). No new status column — the client polls for `cover_letter_pdf_path`
  or `cover_letter_error` appearing.
- **Worker** owns generation + render (the LLM call exceeds Netlify's ~26s ceiling, same as
  `/tailor`). New `POST /cover-letter {id}` checks cheap preconditions synchronously, acks
  **202**, then in the background: one LLM call on the **Tailoring** model
  (`generateCoverLetter`, `coverLetter.js`) → render to a one-page PDF (`renderCoverLetterPdf`
  + `renderCoverLetterHtml`, no fit-to-one-page search since a letter is naturally a page) →
  upload → write `cover_letter` + `cover_letter_pdf_path`. On failure it writes
  `cover_letter_error`.
- **Truthfulness** holds: the prompt uses only what's in the base résumé — never invents
  employers, titles, dates, metrics, or skills — and strips em-dashes / AI-tell words, like
  the résumé prompts (ADR 0033). It does **not** depend on a tailored résumé existing; it's
  drawn from the **base** résumé + the job, so it works even before tailoring.
- **Routes** `POST /api/applications/[id]/cover-letter` (proxy to the worker) and
  `GET /api/applications/[id]/cover-letter/pdf` (short-lived signed URL with a
  "Name - Company - Cover Letter.pdf" filename, mirroring ADR 0030).
- **UX** (per the user's choice): its **own button**, **one-click generate + download** (no
  in-app editor). The row shows a "Cover letter" generate button → a spinner while writing →
  a "Cover" download button once ready; clicking generate auto-downloads when it lands. The
  expanded panel carries the full control (generate/regenerate, download, error) so it works
  on mobile and independent of the résumé.

## Consequences
- Each application can produce two downloads — résumé and cover letter — from the same row.
- Two moving parts must be deployed together: **migration 0026** (run) and the **worker**
  (new `/cover-letter` endpoint + `coverLetter.js`/template/render) needs a restart; the
  Next app ships on the normal deploy.
- The cover letter uses the **Tailoring** model/key. With no editor, tweaks mean Regenerate;
  an editable letter + re-render-from-text is a natural follow-up (the text is already stored).
- Deleting an application leaves its `<id>-cover.pdf` in the bucket (same as the résumé PDF) —
  harmless; a future storage cleanup could remove both.
