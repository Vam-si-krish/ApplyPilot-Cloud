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
  getJobsByIds,
  getScoringResumeText,
  updateJob,
  updateApplication,
  uploadPdf,
} from './supabase.js';
import { scoreJobWorker } from './scoring.js';
import { renderResumeToOnePage, renderCoverLetterPdf, getBrowser, closeBrowser } from './render.js';
import { makeClient, tailorResume, condenseResume } from './tailor.js';
import { makeAgentClient } from './agentClient.js';
import { generateCoverLetter } from './coverLetter.js';

const LLM_PROVIDERS = new Set(['gemini', 'openai', 'deepseek', 'anthropic']);
// ADR 0042: pseudo-provider that runs the task on the Claude subscription via the
// Agent SDK (no vault key) instead of a paid API key.
const SUBSCRIPTION_PROVIDER = 'subscription';

/**
 * Resolve the LLM client for a provider+model (ADR 0025/0042):
 *  - 'subscription' → the Agent SDK client (no key; uses the Claude plan).
 *  - an API provider → makeClient with its active vault key.
 * Returns { client } on success, or { error } describing what's missing.
 */
async function resolveTaskClient(provider, model) {
  if (provider === SUBSCRIPTION_PROVIDER) return { client: makeAgentClient(model) };
  if (!LLM_PROVIDERS.has(provider)) {
    return { error: `Provider "${provider || '(unset)'}" is not a supported LLM provider.` };
  }
  const key = await getActiveApiKey(provider);
  if (!key) return { error: `No active ${provider} API key — add one under Settings → AI tokens.` };
  return { client: makeClient(provider, model, key) };
}

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

/**
 * POST /score-jobs {ids: string[]} → {ok, queued} (ADR 0042).
 * Scores the given job IDs using the subscription provider (Agent SDK). Designed to
 * be called by the cloud app's /api/score-selected when scoring provider is
 * 'subscription' — the Netlify function times out waiting for individual /llm calls,
 * so it delegates the whole batch here. Responds 200 immediately; scoring runs in
 * the background and writes directly to Supabase.
 */
app.post('/score-jobs', async (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'unauthorized' });

  const ids = req.body?.ids;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids[] required' });
  }
  if (ids.length > 20) {
    return res.status(400).json({ error: 'max 20 ids per call' });
  }

  let settings, resolved;
  try {
    settings = await getSettings();
    const provider = (settings.score_provider || settings.llm_provider || '').trim().toLowerCase();
    const model = (settings.score_model || settings.llm_model || '').trim();
    resolved = await resolveTaskClient(provider, model);
    if (resolved.error) return res.status(409).json({ error: resolved.error });
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }

  // All preconditions met — ack immediately, score in background.
  res.json({ ok: true, queued: ids.length });

  const allowRescore = !!settings.allow_rescore;
  const client = resolved.client;

  (async () => {
    const [jobs, resumeText] = await Promise.all([getJobsByIds(ids), getScoringResumeText()]);
    const toScore = allowRescore ? jobs : jobs.filter((j) => j.status === 'unscored' || j.status === 'filtered');
    console.log(`[score-jobs] scoring ${toScore.length}/${ids.length} jobs`);

    await Promise.all(
      toScore.map(async (job) => {
        try {
          const result = await scoreJobWorker(resumeText, job, client);
          const breakdown = result.breakdown
            ? { ...result.breakdown, missing: result.missing ?? null, seniority: result.seniority ?? null }
            : null;
          await updateJob(job.id, {
            fit_score: result.score,
            score_note: result.note,
            score_keywords: result.keywords,
            score_reasoning: result.reasoning,
            score_breakdown: breakdown,
            employment_type: result.employment_type ?? null,
            scored_at: new Date().toISOString(),
            status: 'scored',
          });
          console.log(`[score-jobs] job ${job.id} scored ${result.score}`);
        } catch (e) {
          console.error(`[score-jobs] job ${job.id} failed:`, e instanceof Error ? e.message : String(e));
        }
      }),
    );

    console.log(`[score-jobs] done`);
  })().catch((e) => console.error('[score-jobs] background error:', e instanceof Error ? e.message : String(e)));
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

    // Build an AI-condense fn if a tailoring provider + active key is configured.
    // If not, the renderer falls back to the deterministic backstop, which still
    // guarantees one page (ADR 0031).
    let condenseFn = null;
    try {
      const settings = await getSettings();
      const provider = (settings.tailor_provider || settings.llm_provider || '').trim().toLowerCase();
      const model = (settings.tailor_model || settings.llm_model || '').trim();
      const { client } = await resolveTaskClient(provider, model);
      if (client) condenseFn = (resume, pass) => condenseResume(resume, client, pass);
    } catch {
      /* settings/key unavailable → deterministic backstop only */
    }

    const { pdf, scale, pages, tooLong, resume, condensed, trimmed } = await renderResumeToOnePage(
      appRow.tailored_resume,
      template,
      condenseFn,
    );

    const path = `${id}.pdf`;
    await uploadPdf(path, pdf);

    const update = {
      status: 'ready',
      pdf_path: path,
      error: tooLong
        ? 'Content is very long — shrunk to one page; consider shortening.'
        : trimmed
          ? 'Content ran long — trimmed the least-important detail to fit one page.'
          : null,
    };
    // If the résumé was shortened to fit, persist it so the on-screen copy matches the
    // PDF, and clear the stale tailored fit score (content changed; the app re-scores).
    if (condensed || trimmed) {
      update.tailored_resume = resume;
      update.tailored_fit_score = null;
      update.tailored_score_note = null;
    }
    await updateApplication(id, update);

    res.json({ ok: true, pdf_path: path, pages, scale, tooLong, condensed, trimmed, bytes: pdf.length });
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
    const resolved = await resolveTaskClient(provider, model);
    if (resolved.error) return res.status(409).json({ error: resolved.error });

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

    const client = resolved.client;
    tailorResume(base, job, signals, client, appRow.tailor_instructions || '')
      .then(({ resume, changes }) =>
        // Clear any stale tailored score — the app re-scores the new résumé (ADR 0029).
        updateApplication(id, {
          tailored_resume: resume,
          tailor_changes: changes,
          status: 'ready',
          error: null,
          tailored_fit_score: null,
          tailored_score_note: null,
        }),
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

/**
 * POST /cover-letter {id} → write a cover letter for an application: one LLM call on
 * the TAILORING model to draft it from the base résumé + job, render it to a one-page
 * PDF, upload it, and store cover_letter + cover_letter_pdf_path (ADR 0035). Same
 * async-ack shape as /tailor (the LLM call exceeds Netlify's function ceiling): cheap
 * preconditions are checked synchronously; then it responds 202 and finishes in the
 * background while the UI polls the row for cover_letter_pdf_path / cover_letter_error.
 */
app.post('/cover-letter', async (req, res) => {
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
    const resolved = await resolveTaskClient(provider, model);
    if (resolved.error) return res.status(409).json({ error: resolved.error });

    const job = appRow.job;
    // All preconditions met — clear any prior error, ack, then do the slow work async.
    await updateApplication(id, { cover_letter_error: null }).catch(() => {});
    res.status(202).json({ ok: true });

    const client = resolved.client;
    (async () => {
      const text = await generateCoverLetter(base, job, client);
      const pdf = await renderCoverLetterPdf(text, base.basics || {}, job, appRow.template || 'classic');
      const path = `${id}-cover.pdf`;
      await uploadPdf(path, pdf);
      await updateApplication(id, { cover_letter: text, cover_letter_pdf_path: path, cover_letter_error: null });
    })().catch((e) => {
      const msg = e instanceof Error ? e.message : String(e);
      return updateApplication(id, { cover_letter_error: msg }).catch(() => {});
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
    // No DB row / LLM client here, so the deterministic backstop guarantees one page.
    const { pdf, pages, scale, tooLong } = await renderResumeToOnePage(resume, template, null);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('X-Resume-Pages', String(pages));
    res.setHeader('X-Resume-Scale', String(scale));
    res.setHeader('X-Resume-Too-Long', String(tooLong));
    res.send(pdf);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/**
 * POST /llm { messages, model?, temperature?, maxTokens? } → { text } (ADR 0042).
 * Runs ONE single-turn completion on the Claude subscription via the Agent SDK. This
 * is the backend for the cloud app's serverless AI lanes (scoring, company check, mail
 * classify, assistant, résumé parse) when their provider is set to "subscription" —
 * the model can only run here, where the `claude` CLI + subscription credentials live.
 */
app.post('/llm', async (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'unauthorized' });

  const body = req.body || {};
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return res.status(400).json({ error: 'messages[] required' });
  }
  const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : 'sonnet';
  const temperature = typeof body.temperature === 'number' ? body.temperature : undefined;
  const maxTokens = typeof body.maxTokens === 'number' ? body.maxTokens : undefined;

  try {
    const text = await makeAgentClient(model).chat(body.messages, { temperature, maxTokens });
    res.json({ text });
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
