/**
 * ApplyPilot résumé worker (ADR 0024 Phase 3). Express service that renders an
 * application's tailored résumé JSON into a one-page, ATS-readable PDF and uploads
 * it to Supabase Storage. The Netlify app calls POST /generate over a Cloudflare
 * Tunnel; auth is a shared Bearer secret.
 *
 *   GET  /health           → { ok, browser }
 *   POST /generate {id}    → render application <id> → upload → mark ready+pdf_path
 */
import 'dotenv/config';
import express from 'express';
import { getApplication, updateApplication, uploadPdf } from './supabase.js';
import { renderResumePdf, getBrowser, closeBrowser } from './render.js';

const app = express();
app.use(express.json({ limit: '2mb' }));

const PORT = process.env.PORT || 8787;
const SECRET = process.env.WORKER_SECRET || '';

function authed(req) {
  if (!SECRET) return false; // refuse to run wide-open
  const h = req.get('authorization') || '';
  return h.startsWith('Bearer ') && h.slice(7) === SECRET;
}

app.get('/health', async (_req, res) => {
  let browser = false;
  try {
    const b = await getBrowser();
    browser = !!b.connected;
  } catch {
    browser = false;
  }
  res.json({ ok: true, browser, ts: new Date().toISOString() });
});

app.post('/generate', async (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'unauthorized' });

  const id = req.body && req.body.id;
  if (!id || typeof id !== 'string') return res.status(400).json({ error: 'id required' });

  try {
    const appRow = await getApplication(id);
    if (!appRow) return res.status(404).json({ error: 'application not found' });
    if (!appRow.tailored_resume) {
      return res.status(409).json({ error: 'no tailored résumé — generate it first' });
    }

    await updateApplication(id, { status: 'generating', error: null }).catch(() => {});

    const template = appRow.template || 'classic';
    const { pdf, scale, pages, tooLong } = await renderResumePdf(appRow.tailored_resume, template);

    const path = `${id}.pdf`;
    await uploadPdf(path, pdf);
    await updateApplication(id, { status: 'ready', pdf_path: path, error: tooLong ? 'Content is long — trimmed to fit one page; consider shortening.' : null });

    res.json({ ok: true, pdf_path: path, pages, scale, tooLong, bytes: pdf.length });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await updateApplication(id, { status: 'failed', error: msg }).catch(() => {});
    res.status(500).json({ error: msg });
  }
});

const server = app.listen(PORT, () => {
  console.log(`résumé worker listening on :${PORT}`);
});

async function shutdown() {
  console.log('shutting down…');
  await closeBrowser();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
