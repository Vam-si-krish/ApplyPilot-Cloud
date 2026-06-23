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
import {
  getApplication,
  getApplicationWithJob,
  getBaseResume,
  getSettings,
  getActiveApiKey,
  updateApplication,
  uploadPdf,
} from './supabase.js';
import { renderResumePdf, getBrowser, closeBrowser } from './render.js';
import { makeClient, tailorResume } from './tailor.js';

const LLM_PROVIDERS = new Set(['gemini', 'openai', 'deepseek', 'anthropic']);

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

/**
 * POST /tailor {id} → run the one-shot LLM résumé tailoring for an application and
 * write tailored_resume + tailor_changes + status. This lives on the worker (not a
 * Netlify route) because the LLM call can take 30–90s — far over Netlify's ~26s
 * function ceiling. Cheap preconditions are checked synchronously and returned as
 * errors; the slow LLM call then runs in the background, responding 202 right away
 * so the caller (and the platform) never wait on it. The UI polls the row status.
 */
app.post('/tailor', async (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'unauthorized' });

  const id = req.body && req.body.id;
  if (!id || typeof id !== 'string') return res.status(400).json({ error: 'id required' });

  try {
    const appRow = await getApplicationWithJob(id);
    if (!appRow) return res.status(404).json({ error: 'application not found' });
    if (!appRow.job) return res.status(409).json({ error: 'the job for this application was removed' });

    const base = await getBaseResume();
    if (!base || !Array.isArray(base.work) || base.work.length === 0) {
      return res.status(409).json({ error: 'No base résumé yet — build it under Applications → Base résumé first.' });
    }

    const settings = await getSettings();
    const provider = (settings.tailor_provider || settings.llm_provider || '').trim().toLowerCase();
    const model = (settings.tailor_model || settings.llm_model || '').trim();
    if (!LLM_PROVIDERS.has(provider)) {
      return res.status(409).json({ error: `Tailoring provider "${provider || '(unset)'}" is not a supported LLM provider.` });
    }
    const key = await getActiveApiKey(provider);
    if (!key) {
      return res.status(409).json({ error: `No active ${provider} API key — add one under Settings → AI tokens.` });
    }

    const job = appRow.job;
    const signals = {
      missing: (appRow.job.score_breakdown && appRow.job.score_breakdown.missing) || null,
      matched: job.matched_skills || null,
      unmatched: job.unmatched_skills || null,
      keywords: job.score_keywords || null,
    };

    // All preconditions met — mark generating, ack, then do the slow LLM call async.
    await updateApplication(id, { status: 'generating', error: null }).catch(() => {});
    res.status(202).json({ ok: true, status: 'generating' });

    const client = makeClient(provider, model, key);
    tailorResume(base, job, signals, client)
      .then(({ resume, changes }) =>
        updateApplication(id, { tailored_resume: resume, tailor_changes: changes, status: 'ready', error: null }),
      )
      .catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        return updateApplication(id, { status: 'failed', error: msg }).catch(() => {});
      });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!res.headersSent) res.status(500).json({ error: msg });
  }
});

// Render arbitrary résumé JSON to a PDF and return the bytes directly — no DB row.
// Used by the manual "paste a JD → download a résumé" flow (ADR 0024).
app.post('/render-inline', async (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'unauthorized' });

  const resume = req.body && req.body.resume;
  const template = (req.body && req.body.template) || 'classic';
  if (!resume || typeof resume !== 'object') return res.status(400).json({ error: 'resume required' });

  try {
    const { pdf, pages, scale, tooLong } = await renderResumePdf(resume, template);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('X-Resume-Pages', String(pages));
    res.setHeader('X-Resume-Scale', String(scale));
    res.setHeader('X-Resume-Too-Long', String(tooLong));
    res.send(pdf);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
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
