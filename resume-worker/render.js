/**
 * PDF rendering with auto-fit-to-one-page (ADR 0024 Phase 3).
 *
 * The whole document scales off one CSS variable (`--scale`). We binary-search the
 * LARGEST scale that still renders as a single page, using the ACTUAL PDF page count
 * (via pdf-lib) as the fit signal — robust, no fragile screen-px↔print math. There's
 * a readable floor (~9.5pt): if content overflows even at the floor, we render at the
 * floor and return `tooLong: true` so the UI can prompt a trim instead of silently
 * spilling to page 2. Output is selectable text (standard fonts), ATS-friendly.
 */
import puppeteer from 'puppeteer';
import { PDFDocument } from 'pdf-lib';
import { renderHtml, renderCoverLetterHtml } from './templates.js';

// Scale bounds. base font = 10.5pt * scale, so floor 0.86 ≈ 9.0pt (readable floor).
// Ceiling is 1.0 so the exact spec font sizes are used whenever the content fits a
// single page (the design is tuned to those sizes); we only ever shrink — never
// inflate above the spec. Floor keeps it readable if a job's content runs long.
const SCALE_FLOOR = 0.78;
const SCALE_CEIL = 1.0;

let _browser = null;

/** Launch (once) and reuse a headless Chromium. */
export async function getBrowser() {
  if (_browser && _browser.connected) return _browser;
  _browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=none'],
  });
  return _browser;
}

export async function closeBrowser() {
  if (_browser) {
    await _browser.close().catch(() => {});
    _browser = null;
  }
}

/**
 * Render a cover letter (ADR 0035). A letter is naturally about a page, so there's no
 * fit-to-one-page search — just print the HTML with comfortable 1in letter margins.
 * @returns {Promise<Buffer>} PDF bytes.
 */
export async function renderCoverLetterPdf(text, basics = {}, job = {}, template = 'classic') {
  const html = renderCoverLetterHtml(text, basics, job, template);
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({
      format: 'Letter',
      printBackground: true,
      preferCSSPageSize: false,
      margin: { top: '1in', bottom: '1in', left: '1in', right: '1in' },
    });
    return Buffer.from(pdf);
  } finally {
    await page.close().catch(() => {});
  }
}

/** Render the résumé at a fixed scale → PDF bytes + page count. */
async function renderAtScale(page, resume, template, scale) {
  const html = renderHtml(resume, { template, scale });
  await page.setContent(html, { waitUntil: 'networkidle0' });
  const pdf = await page.pdf({
    format: 'Letter',
    printBackground: true,
    preferCSSPageSize: false,
    margin: { top: '0.4in', bottom: '0.38in', left: '0.5in', right: '0.5in' },
  });
  const doc = await PDFDocument.load(pdf);
  return { pdf, pages: doc.getPageCount() };
}

/**
 * Render a résumé to a one-page PDF.
 * @returns {Promise<{ pdf: Buffer, scale: number, pages: number, tooLong: boolean }>}
 */
export async function renderResumePdf(resume, template = 'classic') {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    // 1) Try the ceiling. If it already fits, take it (largest = fills the page well).
    let best = await renderAtScale(page, resume, template, SCALE_CEIL);
    if (best.pages <= 1) {
      return { pdf: Buffer.from(best.pdf), scale: SCALE_CEIL, pages: best.pages, tooLong: false };
    }

    // 2) If even the floor overflows, content is genuinely too long — render at floor + flag.
    const floor = await renderAtScale(page, resume, template, SCALE_FLOOR);
    if (floor.pages > 1) {
      return { pdf: Buffer.from(floor.pdf), scale: SCALE_FLOOR, pages: floor.pages, tooLong: true };
    }

    // 3) Binary-search the largest scale in [floor, ceil] that yields a single page.
    let lo = SCALE_FLOOR; // known 1 page
    let hi = SCALE_CEIL; // known >1 page
    let bestPdf = floor.pdf;
    let bestScale = SCALE_FLOOR;
    for (let i = 0; i < 6; i++) {
      const mid = (lo + hi) / 2;
      const r = await renderAtScale(page, resume, template, mid);
      if (r.pages <= 1) {
        lo = mid;
        bestPdf = r.pdf;
        bestScale = mid;
      } else {
        hi = mid;
      }
    }
    return { pdf: Buffer.from(bestPdf), scale: Number(bestScale.toFixed(3)), pages: 1, tooLong: false };
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * Deterministic backstop (ADR 0031): drop the single least-important bullet — the last
 * highlight of whichever role/project currently has the most — returning a NEW résumé.
 * Never empties an entry (only trims entries with >1 highlight). Returns null when
 * there's nothing left to trim, so the caller's loop terminates.
 */
function dropLeastImportantHighlight(resume) {
  const clone = JSON.parse(JSON.stringify(resume));
  const pools = [...(clone.work || []), ...(clone.projects || [])];
  let target = null;
  for (const e of pools) {
    const n = (e.highlights || []).length;
    if (n > 1 && (!target || n > target.highlights.length)) target = e;
  }
  if (!target) return null;
  target.highlights = target.highlights.slice(0, -1);
  return clone;
}

/**
 * Render to a guaranteed one-page PDF (ADR 0031). Render → if it would spill past the
 * readable font floor, ask the model to CONDENSE (up to 2 passes, `condenseFn` decides
 * what to cut) → re-render; then a deterministic backstop drops the least-important
 * bullets until it fits. The returned `resume` is the (possibly shortened) version that
 * the PDF actually reflects, so the caller can persist it to match what was rendered.
 *
 * @param {object} resume
 * @param {string} template
 * @param {null | ((resume: object, pass: number) => Promise<object>)} condenseFn
 * @returns {Promise<{ pdf: Buffer, scale: number, pages: number, tooLong: boolean, resume: object, condensed: boolean, trimmed: boolean }>}
 */
export async function renderResumeToOnePage(resume, template = 'classic', condenseFn = null) {
  let current = resume;
  let r = await renderResumePdf(current, template);
  let condensed = false;
  let trimmed = false;

  // 1) AI condense passes (preferred — the model chooses what to shorten/drop).
  for (let pass = 0; condenseFn && r.tooLong && pass < 2; pass++) {
    try {
      const next = await condenseFn(current, pass);
      if (!next) break;
      current = next;
      condensed = true;
    } catch {
      break; // LLM unavailable/failed — fall through to the deterministic backstop
    }
    r = await renderResumePdf(current, template);
  }

  // 2) Deterministic backstop — guarantees one page even if condensing is unavailable.
  for (let guard = 0; r.tooLong && guard < 8; guard++) {
    const next = dropLeastImportantHighlight(current);
    if (!next) break; // nothing left to trim
    current = next;
    trimmed = true;
    r = await renderResumePdf(current, template);
  }

  return { ...r, resume: current, condensed, trimmed };
}
