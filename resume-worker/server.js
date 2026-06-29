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
  getQueuedApplications,
  getScoringResumeText,
  resumeToScoringText,
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
async function resolveTaskClient(provider, model, label = 'task') {
  if (provider === SUBSCRIPTION_PROVIDER) return { client: makeAgentClient(model, label) };
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
      const { client } = await resolveTaskClient(provider, model, 'condense');
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
    const resolved = await resolveTaskClient(provider, model, 'tailor');
    if (resolved.error) {
      console.error(`[/tailor] precondition failed id=${id} provider=${provider}: ${resolved.error}`);
      return res.status(409).json({ error: resolved.error });
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

    const tStart = Date.now();
    console.log(`[/tailor] start id=${id} provider=${provider} model=${model}`);
    const client = resolved.client;
    tailorResume(base, job, signals, client, appRow.tailor_instructions || '')
      .then(({ resume, changes }) => {
        console.log(`[/tailor] done id=${id} ${Date.now() - tStart}ms`);
        // Clear any stale tailored score — the app re-scores the new résumé (ADR 0029).
        return updateApplication(id, {
          tailored_resume: resume,
          tailor_changes: changes,
          status: 'ready',
          error: null,
          tailored_fit_score: null,
          tailored_score_note: null,
        });
      })
      .catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[/tailor] FAIL id=${id} ${Date.now() - tStart}ms: ${msg}`);
        return updateApplication(id, { status: 'failed', error: msg }).catch(() => {});
      });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!res.headersSent) res.status(500).json({ error: msg });
  }
});

// Build the signals block the tailorer expects from a job row (shared by /tailor and the
// queue drainer). Mirrors the inline shape in /tailor above.
function tailorSignals(job) {
  return {
    missing: (job.score_breakdown && job.score_breakdown.missing) || null,
    matched: job.matched_skills || null,
    unmatched: job.unmatched_skills || null,
    keywords: job.score_keywords || null,
  };
}

/**
 * Run the full per-application pipeline ONCE, synchronously: tailor → render+upload PDF →
 * score the tailored résumé. Each step's failure is contained; the function throws only
 * if tailoring itself fails (no résumé to render/score). Returns a small status object.
 * Reused by the nightly queue drainer; mirrors the manual "Generate selected" pipeline.
 */
async function runFullPipeline({ appRow, base, tailorClient, scoreClient }) {
  const id = appRow.id;
  const job = appRow.job;

  // 1. Tailor (the one expensive LLM call). Throwing here marks the row failed below.
  await updateApplication(id, { status: 'generating', error: null }).catch(() => {});
  const { resume, changes } = await tailorResume(base, job, tailorSignals(job), tailorClient, appRow.tailor_instructions || '');
  await updateApplication(id, {
    tailored_resume: resume,
    tailor_changes: changes,
    status: 'ready',
    error: null,
    tailored_fit_score: null,
    tailored_score_note: null,
  });

  // 2. Render + upload the PDF (best-effort — a render failure shouldn't lose the résumé).
  let rendered = resume;
  try {
    const condenseFn = (r, pass) => condenseResume(r, tailorClient, pass);
    const out = await renderResumeToOnePage(resume, appRow.template || 'classic', condenseFn);
    await uploadPdf(`${id}.pdf`, out.pdf);
    const update = {
      pdf_path: `${id}.pdf`,
      error: out.tooLong
        ? 'Content is very long — shrunk to one page; consider shortening.'
        : out.trimmed
          ? 'Content ran long — trimmed the least-important detail to fit one page.'
          : null,
    };
    if (out.condensed || out.trimmed) {
      rendered = out.resume;
      update.tailored_resume = out.resume;
    }
    await updateApplication(id, update);
  } catch (e) {
    console.error(`[/tailor-queue] render failed id=${id}: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 3. Score the tailored résumé (best-effort — a scoring failure shouldn't fail the row).
  if (scoreClient) {
    try {
      const result = await scoreJobWorker(resumeToScoringText(rendered), job, scoreClient);
      await updateApplication(id, { tailored_fit_score: result.score, tailored_score_note: result.note });
    } catch (e) {
      console.error(`[/tailor-queue] score failed id=${id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { id, status: 'ready' };
}

/** Current hour (0–23) in an IANA timezone, DST-correct. Falls back to UTC on a bad tz. */
function hourInTz(tz) {
  try {
    const h = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: tz }).format(new Date());
    const n = parseInt(h, 10); // 'en-US' can render midnight as '24'
    return Number.isFinite(n) ? n % 24 : new Date().getUTCHours();
  } catch {
    return new Date().getUTCHours();
  }
}

/**
 * POST /tailor-queue → drain the overnight tailoring queue (ADR 0043). Fetches every
 * application in status 'queued' (awaiting tailoring) and runs the full pipeline for each
 * — tailor → render+PDF → score — ONE AT A TIME (so a burst can't blow the Claude
 * subscription window and so subscription account-failover works per call). Each row is
 * independent: a failure marks that row 'failed' with a reason and the drain continues.
 *
 * SCHEDULING (the app is on Netlify — vercel.json crons do NOT fire here): the always-on
 * Worker Mac's launchd job pings this HOURLY with `{ scheduled: true }`. When `scheduled`
 * is set, the worker self-gates on the DB Settings: it no-ops unless `auto_tailor_enabled`
 * is true AND the current hour in the user's timezone matches `auto_tailor_time` — so the
 * Settings UI stays the source of truth for the time (change it on the web, no plist edit).
 * A manual call (the "Run queue now" button, or any POST WITHOUT `scheduled`) bypasses the
 * gate and drains immediately. The worker acks 202 then drains in the background.
 */
app.post('/tailor-queue', async (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'unauthorized' });

  // Optional safety cap from the caller; default high.
  const limit = Number.isFinite(req.body?.limit) && req.body.limit > 0 ? Math.floor(req.body.limit) : 200;
  // launchd fires hourly with scheduled:true; only then do we honor the UI toggle + hour.
  const scheduled = req.body?.scheduled === true;

  let base, tailorClient, scoreClient, queued;
  try {
    const settings = await getSettings();

    // Scheduled path: respect the Settings UI (enabled + the configured hour). Manual
    // calls skip this so "Run queue now" always works regardless of schedule.
    if (scheduled) {
      if (settings.auto_tailor_enabled !== true) {
        return res.json({ ok: true, skipped: true, reason: 'auto_tailor_enabled is false' });
      }
      const wantHour = parseInt(String(settings.auto_tailor_time || '04:00').split(':')[0], 10);
      const nowHour = hourInTz(settings.timezone || 'UTC');
      if (Number.isFinite(wantHour) && nowHour !== wantHour) {
        return res.json({ ok: true, skipped: true, reason: `not the scheduled hour (now ${nowHour}, want ${wantHour})` });
      }
    }

    base = await getBaseResume();
    if (!base || !Array.isArray(base.work) || base.work.length === 0) {
      return res.status(409).json({ error: 'No base résumé yet — build it under Applications → Base résumé first.' });
    }

    // Tailoring client (required) — the queue can't run without it.
    const tProvider = (settings.tailor_provider || settings.llm_provider || '').trim().toLowerCase();
    const tModel = (settings.tailor_model || settings.llm_model || '').trim();
    const tResolved = await resolveTaskClient(tProvider, tModel, 'tailor');
    if (tResolved.error) return res.status(409).json({ error: tResolved.error });
    tailorClient = tResolved.client;

    // Scoring client (optional) — if unconfigured, résumés are tailored+rendered but not scored.
    const sProvider = (settings.score_provider || settings.llm_provider || '').trim().toLowerCase();
    const sModel = (settings.score_model || settings.llm_model || '').trim();
    const sResolved = await resolveTaskClient(sProvider, sModel, 'score');
    scoreClient = sResolved.error ? null : sResolved.client;

    queued = await getQueuedApplications();
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }

  const batch = queued.slice(0, limit);
  // Ack immediately — the drain runs for many minutes in the background.
  res.status(202).json({ ok: true, queued: queued.length, processing: batch.length });

  (async () => {
    const t0 = Date.now();
    let ok = 0;
    let failed = 0;
    console.log(`[/tailor-queue] start — ${batch.length} of ${queued.length} queued (limit ${limit})`);
    for (const appRow of batch) {
      try {
        await runFullPipeline({ appRow, base, tailorClient, scoreClient });
        ok++;
        console.log(`[/tailor-queue] ok ${ok}/${batch.length} id=${appRow.id}`);
      } catch (e) {
        failed++;
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[/tailor-queue] FAIL id=${appRow.id}: ${msg}`);
        await updateApplication(appRow.id, { status: 'failed', error: msg }).catch(() => {});
      }
    }
    console.log(`[/tailor-queue] done — ${ok} generated, ${failed} failed in ${Math.round((Date.now() - t0) / 1000)}s`);
  })().catch((e) => console.error('[/tailor-queue] drain error:', e instanceof Error ? e.message : String(e)));
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
    const resolved = await resolveTaskClient(provider, model, 'cover');
    if (resolved.error) {
      console.error(`[/cover-letter] precondition failed id=${id} provider=${provider}: ${resolved.error}`);
      return res.status(409).json({ error: resolved.error });
    }

    const job = appRow.job;
    // All preconditions met — clear any prior error, ack, then do the slow work async.
    await updateApplication(id, { cover_letter_error: null }).catch(() => {});
    res.status(202).json({ ok: true });

    const tStart = Date.now();
    console.log(`[/cover-letter] start id=${id} provider=${provider} model=${model}`);
    const client = resolved.client;
    (async () => {
      const text = await generateCoverLetter(base, job, client);
      const pdf = await renderCoverLetterPdf(text, base.basics || {}, job, appRow.template || 'classic');
      const path = `${id}-cover.pdf`;
      await uploadPdf(path, pdf);
      await updateApplication(id, { cover_letter: text, cover_letter_pdf_path: path, cover_letter_error: null });
      console.log(`[/cover-letter] done id=${id} ${Date.now() - tStart}ms`);
    })().catch((e) => {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[/cover-letter] FAIL id=${id} ${Date.now() - tStart}ms: ${msg}`);
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

  const t0 = Date.now();
  console.log(`[/llm] request model=${model} messages=${body.messages.length}`);
  try {
    const text = await makeAgentClient(model, 'llm').chat(body.messages, { temperature, maxTokens });
    console.log(`[/llm] ok model=${model} ${Date.now() - t0}ms textLen=${text.length}`);
    res.json({ text });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[/llm] FAIL model=${model} ${Date.now() - t0}ms: ${msg}`);
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

// Diagnostics (ADR 0042): a crash mid-tailoring would leave the row stuck 'generating'
// (the in-process timeout dies with the process), which looks like "keeps loading". Log
// loudly so the cause is in the worker log. Keep running on an unhandled rejection (often
// recoverable); on a truly uncaught exception, log then exit so launchd restarts cleanly.
process.on('unhandledRejection', (reason) => {
  console.error('[worker] UNHANDLED REJECTION:', reason instanceof Error ? reason.stack || reason.message : reason);
});
process.on('uncaughtException', (err) => {
  console.error('[worker] UNCAUGHT EXCEPTION:', err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});
