# 0062 — Blob downloads fix the concurrent résumé + cover-letter race

## Context

Auto-download-on-open (ADR 0061) is meant to download a job's tailored résumé PDF **and**
its cover-letter PDF when the posting is opened from a Tailor & Apply row. Users reported it
was inconsistent: sometimes only the résumé arrived, sometimes only the cover letter, sometimes
both.

Root cause: `/api/applications/[id]/pdf` and `.../cover-letter/pdf` return **Supabase Storage
signed URLs**, which are **cross-origin**. For a cross-origin `href`, browsers **ignore the
`<a download>` attribute** and treat `a.click()` as a **top-level navigation** (it downloads
only because the signed URL carries `Content-Disposition: attachment`). The open handler fired
both downloads back-to-back:

```js
if (a.pdf_path) downloadPdf(a.id);
if (a.cover_letter_pdf_path) downloadCoverPdf(a.id);
```

Each first `fetch`es its signed URL, then clicks — so the two navigations race, and the browser
cancels the first in-flight navigation when the second starts. Whichever signed-URL fetch
resolved first won; the timing decided which file(s) landed.

## Decision

1. **Download via a same-origin blob URL** (`triggerDownload`): fetch the signed URL's bytes,
   wrap them in `URL.createObjectURL(blob)`, and click an `<a download>` on that. Blob URLs are
   same-origin, so the `download` filename is honoured and the click is **not** a top-level
   navigation — any number can run concurrently without racing. The object URL is revoked after
   15 s. On any failure (e.g. a blob fetch blocked by CORS) it falls back to the old direct-URL
   navigation, which still downloads one file via `Content-Disposition`.
2. **Serialize the two auto-downloads**: the open handler now `await`s the résumé download
   before starting the cover letter, inside a fire-and-forget async IIFE (the anchor's own
   new-tab navigation is unaffected).

Both `downloadPdf` / `downloadCoverPdf` now return `Promise<boolean>` and route through
`triggerDownload`; all their other call sites (per-row buttons, the cover-letter generation
flow) transparently benefit — the bulk cover-letter path that could fire several downloads at
once is now safe too.

## Consequences

- Auto-download reliably delivers every existing PDF for the opened job.
- Downloads now transfer through the browser tab (blob) rather than a bare navigation; the
  files are small (one-page PDFs) so the extra fetch is negligible, and filenames are still the
  ADR-0030 "Name - Company - Resume.pdf" convention (blob `download` attr, no longer reliant on
  the cross-origin `Content-Disposition`).
- Chrome may still show its one-time "allow multiple downloads" prompt for two files; the
  existing UI hint already tells the user to allow it. Client-only change; no API/worker touched.
