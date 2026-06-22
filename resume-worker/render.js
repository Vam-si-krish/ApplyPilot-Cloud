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
import { renderHtml } from './templates.js';

// Scale bounds. base font = 10.5pt * scale, so floor 0.86 ≈ 9.0pt (readable floor).
const SCALE_FLOOR = 0.86;
const SCALE_CEIL = 1.12;
const PAGE_MARGIN_IN = 0.45; // scaled with the document

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

/** Render the résumé at a fixed scale → PDF bytes + page count. */
async function renderAtScale(page, resume, template, scale) {
  const html = renderHtml(resume, { template, scale });
  await page.setContent(html, { waitUntil: 'networkidle0' });
  const marginIn = (PAGE_MARGIN_IN * (0.8 + 0.2 * scale)).toFixed(3) + 'in';
  const pdf = await page.pdf({
    format: 'Letter',
    printBackground: true,
    preferCSSPageSize: false,
    margin: { top: marginIn, bottom: marginIn, left: marginIn, right: marginIn },
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
