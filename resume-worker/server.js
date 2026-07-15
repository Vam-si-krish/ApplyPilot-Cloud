/**
 * ApplyPilot résumé worker (ADR 0024 Phase 3). Express service that renders an
 * application's tailored résumé JSON into a one-page, ATS-readable PDF and uploads
 * it to Supabase Storage. The Netlify app calls POST /generate over a Cloudflare
 * Tunnel; auth is a shared Bearer secret.
 *
 *   GET  /health           → { ok, browser }
 *   GET  /version          → { commit, features } (redeploy check; no auth)
 *   POST /generate {id}    → render application <id> → upload → mark ready+pdf_path
 */
import 'dotenv/config';
import express from 'express';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import {
  getApplication,
  getApplicationWithJob,
  getBaseResume,
  getCandidatePreferences,
  getSettings,
  getActiveApiKey,
  getJobsByIds,
  getQueuedApplications,
  getScoringCandidateContext,
  updateJob,
  updateApplication,
  uploadPdf,
} from './supabase.js';
import { scoreJobWorker } from './scoring.js';
import { assessCompany } from './companyCheck.js';
import { renderResumeToOnePage, renderCoverLetterPdf, getBrowser, closeBrowser } from './render.js';
import { makeClient, tailorResume, condenseResume } from './tailor.js';
import { makeAgentClient } from './agentClient.js';
import { makeChatGPTClient } from './chatgptClient.js';
import {
  chatgptConnectionStatus,
  disconnectChatGPTConnection,
  startChatGPTConnection,
} from './chatgptConnection.js';
import {
  claudeConnectionStatus,
  completeClaudeConnection,
  disconnectClaudeConnection,
  startClaudeConnection,
} from './claudeConnection.js';
import { generateCoverLetter } from './coverLetter.js';
import { currentUserId, runAsUser, validUserId } from './userContext.js';

const LLM_PROVIDERS = new Set(['gemini', 'openai', 'deepseek', 'anthropic']);
// Worker-only subscription providers (ADR 0042/0069); neither uses a vault key.
const SUBSCRIPTION_PROVIDER = 'subscription';
const CHATGPT_SUBSCRIPTION_PROVIDER = 'chatgpt_subscription';
const isSubscriptionProvider = (provider) =>
  provider === SUBSCRIPTION_PROVIDER || provider === CHATGPT_SUBSCRIPTION_PROVIDER;

function combinedTailoringInstructions(preferences, perJob = '') {
  const global = typeof preferences?.tailoring_instructions === 'string'
    ? preferences.tailoring_instructions.trim().slice(0, 4000)
    : '';
  const local = typeof perJob === 'string' ? perJob.trim().slice(0, 2000) : '';
  return [
    global ? `GLOBAL CANDIDATE GUIDANCE:\n${global}` : '',
    local ? `JOB-SPECIFIC GUIDANCE:\n${local}` : '',
  ].filter(Boolean).join('\n\n');
}

/**
 * Resolve the LLM client for a provider+model (ADR 0025/0042):
 *  - 'subscription' → Claude Agent SDK (no key; uses the Claude plan).
 *  - 'chatgpt_subscription' → OpenAI Codex SDK (no key; uses the ChatGPT plan).
 *  - an API provider → makeClient with its active vault key.
 * Returns { client } on success, or { error } describing what's missing.
 */
async function resolveTaskClient(provider, model, label = 'task') {
  const sharedOnboarding = label === 'onboarding';
  const ownerId = '00000000-0000-4000-8000-000000000001';
  const userId = currentUserId();
  if (provider === SUBSCRIPTION_PROVIDER) {
    const connection = userId ? await claudeConnectionStatus(userId) : { connected: false };
    if (userId && connection.connected) {
      return { client: makeAgentClient(model, label, userId) };
    }
    // Preserve the shared one-time onboarding lane and the owner's legacy local
    // login. All ordinary work for other accounts requires their own connection.
    if (userId === ownerId || sharedOnboarding) return { client: makeAgentClient(model, label) };
    return { error: 'Connect your Claude subscription under Settings → AI & Models → Claude connection.' };
  }
  if (provider === CHATGPT_SUBSCRIPTION_PROVIDER) {
    const connection = userId ? await chatgptConnectionStatus(userId) : { connected: false };
    if (userId && connection.connected) {
      return { client: makeChatGPTClient(model, label, userId) };
    }
    // Preserve the bounded shared onboarding lane and the owner's legacy login.
    if (userId === ownerId || sharedOnboarding) return { client: makeChatGPTClient(model, label) };
    return { error: 'Connect your ChatGPT subscription under Settings → AI & Models → ChatGPT connection.' };
  }
  if (!LLM_PROVIDERS.has(provider)) {
    return { error: `Provider "${provider || '(unset)'}" is not a supported LLM provider.` };
  }
  const key = await getActiveApiKey(provider);
  if (!key) return { error: `No active ${provider} API key — add one under Settings → Connections & Keys.` };
  return { client: makeClient(provider, model, key) };
}

const app = express();
app.use(express.json({ limit: '2mb' }));

const PORT = process.env.PORT || 8787;
const HOST = process.env.HOST;
const SECRET = process.env.WORKER_SECRET || '';

// Netlify authenticates the user, then forwards the verified UUID. Keep it in an
// async context so every DB/storage call made by this request carries the RLS identity.
app.use((req, res, next) => {
  if (req.method === 'GET' && (req.path === '/health' || req.path === '/version')) return next();
  const userId = req.get('x-jobpilot-user-id');
  if (userId && validUserId(userId)) return runAsUser(userId.toLowerCase(), next);
  return res.status(400).json({ error: 'valid user context required' });
});

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

app.get('/claude-connection/status', async (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'unauthorized' });
  try {
    res.json(await claudeConnectionStatus(currentUserId()));
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post('/claude-connection/start', async (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'unauthorized' });
  try {
    res.json(await startClaudeConnection(currentUserId()));
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post('/claude-connection/complete', async (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'unauthorized' });
  try {
    res.json(await completeClaudeConnection(currentUserId(), req.body?.code));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.delete('/claude-connection', async (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'unauthorized' });
  try {
    res.json(await disconnectClaudeConnection(currentUserId()));
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get('/chatgpt-connection/status', async (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'unauthorized' });
  try {
    res.json(await chatgptConnectionStatus(currentUserId()));
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post('/chatgpt-connection/start', async (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'unauthorized' });
  try {
    res.json(await startChatGPTConnection(currentUserId()));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.delete('/chatgpt-connection', async (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'unauthorized' });
  try {
    res.json(await disconnectChatGPTConnection(currentUserId()));
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

/**
 * GET /version → { commit, features } — a redeploy check. Reports the git commit of the
 * checkout the worker is ACTUALLY running (resolved at request time from this file's dir),
 * plus a static `features` list baked into this build. After pulling on the Worker Mac,
 * `curl <worker>/version` confirms the new code is live: `features` must include
 * "score-jobs-allow-rescore" (the fix that lets subscription re-scoring re-score already-
 * scored jobs). No auth needed — it exposes no secrets.
 */
app.get('/version', (_req, res) => {
  // Static marker: bump this list when adding a feature you want to verify post-deploy.
  const features = ['score-jobs-allow-rescore', 'score-company-parity', 'assess-jobs', 'llm', 'chatgpt-subscription', 'claude-user-login', 'chatgpt-user-login', 'tailor-queue'];
  let commit = 'unknown';
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    commit = execSync('git rev-parse --short HEAD', { cwd: here, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim() || 'unknown';
  } catch {
    /* not a git checkout / git unavailable → leave 'unknown'; features still confirms the build */
  }
  res.json({ ok: true, commit, features, ts: new Date().toISOString() });
});

/**
 * POST /score-jobs {ids: string[]} → {ok, queued} (ADR 0042).
 * Scores the given job IDs using the selected subscription SDK. Designed to
 * be called by the cloud app's /api/score-selected when scoring provider is
 * a subscription provider — Netlify times out waiting for individual /llm calls,
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

  const client = resolved.client;

  (async () => {
    const [jobs, resumeText] = await Promise.all([getJobsByIds(ids), getScoringCandidateContext()]);
    // Only score jobs not yet AI-scored; to re-score, the user deletes the fit score first
    // (Jobs tab, ADR 0048), which resets the job to 'unscored'.
    const toScore = jobs.filter((j) => j.fit_score == null && j.status !== 'archived');
    console.log(`[score-jobs] scoring ${toScore.length}/${ids.length} jobs`);

    // Sequential (ADR 0066): the subscription is window-throttled anyway, and scoring one
    // job at a time lets us read `client.lastUsage` as THIS job's usage — a shared subscription
    // client under Promise.all would race and mis-attribute token/cost across jobs. The
    // stable résumé prefix means job #2+ should read the cache (cacheRead > 0).
    for (const job of toScore) {
      try {
        const result = await scoreJobWorker(resumeText, job, client);
        const breakdown = result.breakdown
          ? { ...result.breakdown, missing: result.missing ?? null, seniority: result.seniority ?? null }
          : null;
        const usage = client.lastUsage ? { ...client.lastUsage } : null;
        const scorePatch = {
          fit_score: result.score,
          score_note: result.note,
          score_keywords: result.keywords,
          score_reasoning: result.reasoning,
          score_breakdown: breakdown,
          company_tier: result.company_tier ?? null,
          company_tier_note: result.company_tier_note ?? null,
          tech_stack: result.tech_stack ?? null,
          score_usage: usage,
          scored_at: new Date().toISOString(),
          status: 'scored',
        };
        // Preserve actor-derived employment metadata when the provider fails or
        // returns an older response without EMPLOYMENT.
        if (result.employment_type != null) scorePatch.employment_type = result.employment_type;
        await updateJob(job.id, scorePatch);
        console.log(`[score-jobs] job ${job.id} scored ${result.score} cacheRead=${usage?.cache_read_input_tokens ?? 0}`);
      } catch (e) {
        console.error(`[score-jobs] job ${job.id} failed:`, e instanceof Error ? e.message : String(e));
      }
    }

    console.log(`[score-jobs] done`);
  })().catch((e) => console.error('[score-jobs] background error:', e instanceof Error ? e.message : String(e)));
});

/**
 * POST /assess-jobs {ids: string[]} → {ok, queued} (ADR 0009/0042). The company-assessment
 * sibling of /score-jobs: assess the companies behind the given jobs (one LLM call each,
 * writing company_tier / company_tier_note) using the SCORING provider. Called by the cloud
 * app's /api/company-check when scoring is a subscription provider, so slow subscription
 * calls run here in the BACKGROUND instead of inside the serverless function's ~60s ceiling.
 * Responds 200 immediately; the app polls /api/score-progress (mode=assess) for progress.
 */
app.post('/assess-jobs', async (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'unauthorized' });

  const ids = req.body?.ids;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids[] required' });
  }
  if (ids.length > 20) {
    return res.status(400).json({ error: 'max 20 ids per call' });
  }

  let resolved;
  try {
    const settings = await getSettings();
    const provider = (settings.score_provider || settings.llm_provider || '').trim().toLowerCase();
    const model = (settings.score_model || settings.llm_model || '').trim();
    resolved = await resolveTaskClient(provider, model, 'assess');
    if (resolved.error) return res.status(409).json({ error: resolved.error });
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }

  // All preconditions met — ack immediately, assess in background.
  res.json({ ok: true, queued: ids.length });

  const client = resolved.client;
  (async () => {
    const jobs = await getJobsByIds(ids);
    console.log(`[assess-jobs] assessing ${jobs.length}/${ids.length} companies`);
    await Promise.all(
      jobs.map(async (job) => {
        try {
          const { tier, note } = await assessCompany(job, client);
          await updateJob(job.id, { company_tier: tier, company_tier_note: note });
          console.log(`[assess-jobs] job ${job.id} → ${tier}`);
        } catch (e) {
          console.error(`[assess-jobs] job ${job.id} failed:`, e instanceof Error ? e.message : String(e));
        }
      }),
    );
    console.log(`[assess-jobs] done`);
  })().catch((e) => console.error('[assess-jobs] background error:', e instanceof Error ? e.message : String(e)));
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
    // This endpoint requires an existing tailored_resume (checked above), so a render
    // failure must not demote the row — the résumé is intact; only the PDF is missing.
    await updateApplication(id, { status: 'ready', error: `PDF render failed — résumé kept. ${msg}` }).catch(() => {});
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

    const [base, preferences] = await Promise.all([getBaseResume(), getCandidatePreferences()]);
    if (!base || !Array.isArray(base.work) || base.work.length === 0) {
      return res.status(409).json({ error: 'No base résumé yet — build it under Candidate Profile → Résumé first.' });
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
    const signals = tailorSignals(job);

    // All preconditions met — mark generating, ack, then do the slow LLM call async.
    await updateApplication(id, { status: 'generating', error: null }).catch(() => {});
    res.status(202).json({ ok: true, status: 'generating' });

    const tStart = Date.now();
    console.log(`[/tailor] start id=${id} provider=${provider} model=${model}`);
    const client = resolved.client;
    tailorResume(base, job, signals, client, combinedTailoringInstructions(preferences, appRow.tailor_instructions))
      .then(async ({ resume, changes, coverLetter, usage }) => {
        console.log(`[/tailor] done id=${id} ${Date.now() - tStart}ms`);
        await updateApplication(id, {
          tailored_resume: resume,
          tailor_changes: changes,
          tailor_usage: usage || null, // what this generation cost (ADR 0064)
          status: 'ready',
          error: null,
        });
        // The same call produced a cover letter (ADR 0051) — render + save it, no extra LLM
        // call. Best-effort; on miss/failure the standalone "Cover letter" button still works.
        await saveEmbeddedCoverLetter(appRow, base, coverLetter).catch(() => {});
      })
      .catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[/tailor] FAIL id=${id} ${Date.now() - tStart}ms: ${msg}`);
        return markTailorFailure(id, msg);
      });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!res.headersSent) res.status(500).json({ error: msg });
  }
});

/**
 * True when an error reads like an exhausted subscription window / provider quota —
 * every further LLM call will fail the same way until the window resets, so batch
 * loops should stop instead of failing their whole remaining tail (ADR 0060).
 */
function isUsageLimitError(msg) {
  return /hit your[\s\S]{0,40}limit|usage limit|rate.?limit|quota|credit balance|out of (credits?|tokens?)/i.test(String(msg || ''));
}

/**
 * Record a tailoring failure WITHOUT clobbering a good row (ADR 0060): a failed
 * REgeneration on a row that already holds a tailored résumé keeps status 'ready'
 * (the previous résumé + PDF remain usable — that's what the user would apply with);
 * only a row with nothing to show becomes 'failed'. The error text is stored either way.
 */
async function markTailorFailure(id, msg) {
  const row = await getApplication(id).catch(() => null);
  if (row && row.tailored_resume) {
    await updateApplication(id, { status: 'ready', error: `Regenerate failed — kept the previous résumé. ${msg}` }).catch(() => {});
  } else {
    await updateApplication(id, { status: 'failed', error: msg }).catch(() => {});
  }
}

// Build the signals block the tailorer expects from a job row (shared by /tailor and the
// queue drainer). atsMissing = exact posting-form terms the base résumé lacks, from the
// local ATS match scan (ADR 0053) — the prompt tells the model to mirror them verbatim.
function tailorSignals(job) {
  return {
    missing: (job.score_breakdown && job.score_breakdown.missing) || null,
    matched: job.matched_skills || null,
    unmatched: job.unmatched_skills || null,
    keywords: job.score_keywords || null,
    atsMissing: (job.prefilter_breakdown && job.prefilter_breakdown.missing) || null,
  };
}

/**
 * Run the full per-application pipeline ONCE, synchronously: tailor → render+upload PDF.
 * Each step's failure is contained; the function throws only if tailoring itself fails (no
 * résumé to render). Returns a small status object. Reused by the nightly queue drainer;
 * mirrors the manual "Generate selected" pipeline.
 *
 * Scoring the tailored résumé is deliberately NOT done here (ADR 0050): the base fit_score
 * already answers "how competitive is this once tailored?" (the rubric is tailoring-aware),
 * so a second score on the same rubric is redundant + spends a call per résumé. The tailored
 * fit is available on demand via the manual "Score résumé" button if ever wanted.
 */
async function runFullPipeline({ appRow, base, tailorClient, preferences }) {
  const id = appRow.id;
  const job = appRow.job;

  // 1. Tailor (the one expensive LLM call). Throwing here marks the row failed below.
  await updateApplication(id, { status: 'generating', error: null }).catch(() => {});
  const { resume, changes, coverLetter, usage } = await tailorResume(
    base, job, tailorSignals(job), tailorClient,
    combinedTailoringInstructions(preferences, appRow.tailor_instructions),
  );
  await updateApplication(id, {
    tailored_resume: resume,
    tailor_changes: changes,
    tailor_usage: usage || null, // what this generation cost (ADR 0064)
    status: 'ready',
    error: null,
  });

  // 2. Render + upload the PDF (best-effort — a render failure shouldn't lose the résumé).
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
    if (out.condensed || out.trimmed) update.tailored_resume = out.resume;
    await updateApplication(id, update);
  } catch (e) {
    console.error(`[/tailor-queue] render failed id=${id}: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 3. Cover letter (ADR 0051): the tailor call already produced one — render + save it, no
  // extra LLM call. Best-effort; if the model omitted it (coverLetter null) or rendering
  // fails, we leave it unset and the user's standalone "Cover letter" button still works.
  await saveEmbeddedCoverLetter(appRow, base, coverLetter).catch(() => {});

  return { id, status: 'ready' };
}

/**
 * Render + persist a cover letter that the tailor call already produced (ADR 0051). No LLM
 * call here. No-op when `coverLetter` is null/blank. Failures are contained (logged, not
 * thrown) — a cover-letter problem must never fail the résumé, and the standalone
 * /cover-letter path remains available as the fallback.
 */
async function saveEmbeddedCoverLetter(appRow, base, coverLetter) {
  if (!coverLetter || !coverLetter.trim()) return;
  const id = appRow.id;
  try {
    const pdf = await renderCoverLetterPdf(coverLetter, base.basics || {}, appRow.job, appRow.template || 'classic');
    const path = `${id}-cover.pdf`;
    await uploadPdf(path, pdf);
    await updateApplication(id, { cover_letter: coverLetter, cover_letter_pdf_path: path, cover_letter_error: null });
    console.log(`[cover-letter] saved from tailor call id=${id}`);
  } catch (e) {
    console.error(`[cover-letter] embedded save failed id=${id}: ${e instanceof Error ? e.message : String(e)}`);
  }
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
 * — tailor → render+PDF → score — ONE AT A TIME (so a burst can't blow the selected
 * subscription window and Claude account-failover remains attributable per call). Each row is
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

  let base, tailorClient, queued, preferences;
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

    [base, preferences] = await Promise.all([getBaseResume(), getCandidatePreferences()]);
    if (!base || !Array.isArray(base.work) || base.work.length === 0) {
      return res.status(409).json({ error: 'No base résumé yet — build it under Candidate Profile → Résumé first.' });
    }

    // Tailoring client (required) — the queue can't run without it.
    const tProvider = (settings.tailor_provider || settings.llm_provider || '').trim().toLowerCase();
    const tModel = (settings.tailor_model || settings.llm_model || '').trim();
    const tResolved = await resolveTaskClient(tProvider, tModel, 'tailor');
    if (tResolved.error) return res.status(409).json({ error: tResolved.error });
    tailorClient = tResolved.client;

    // Scoring the tailored résumé was removed (ADR 0050) — the drain only tailors + renders.

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
        await runFullPipeline({ appRow, base, tailorClient, preferences });
        ok++;
        console.log(`[/tailor-queue] ok ${ok}/${batch.length} id=${appRow.id}`);
      } catch (e) {
        failed++;
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[/tailor-queue] FAIL id=${appRow.id}: ${msg}`);
        await markTailorFailure(appRow.id, msg);
        // Circuit breaker (ADR 0060): once the subscription window / quota is exhausted,
        // every remaining row would fail identically — stop and leave them 'queued' so
        // the next drain (after the window resets) picks them up untouched.
        if (isUsageLimitError(msg)) {
          console.error(`[/tailor-queue] usage limit hit — stopping; ${batch.length - ok - failed} rows stay queued`);
          break;
        }
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
      return res.status(409).json({ error: 'No base résumé yet — build it under Candidate Profile → Résumé first.' });
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
 * POST /llm { messages, provider?, model?, temperature?, maxTokens? } → { text, usage }
 * (ADR 0042/0069). Runs ONE completion on the selected Claude or ChatGPT subscription. This
 * is the backend for the cloud app's serverless AI lanes (scoring, mail classify,
 * assistant, résumé parse) when their provider is a subscription pseudo-provider —
 * the model can only run here, where the local SDK + subscription credentials live.
 */
app.post('/llm', async (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'unauthorized' });

  const body = req.body || {};
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return res.status(400).json({ error: 'messages[] required' });
  }
  // Defaulting to Claude preserves compatibility with an app deployed before ADR 0069.
  const provider = typeof body.provider === 'string' && body.provider.trim()
    ? body.provider.trim().toLowerCase()
    : SUBSCRIPTION_PROVIDER;
  if (!isSubscriptionProvider(provider)) {
    return res.status(400).json({ error: `provider must be ${SUBSCRIPTION_PROVIDER} or ${CHATGPT_SUBSCRIPTION_PROVIDER}` });
  }
  const defaultModel = provider === CHATGPT_SUBSCRIPTION_PROVIDER ? 'gpt-5.4' : 'sonnet';
  const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : defaultModel;
  const temperature = typeof body.temperature === 'number' ? body.temperature : undefined;
  const maxTokens = typeof body.maxTokens === 'number' ? body.maxTokens : undefined;

  const t0 = Date.now();
  console.log(`[/llm] request provider=${provider} model=${model} messages=${body.messages.length}`);
  try {
    const purpose = body.purpose === 'onboarding' ? 'onboarding' : 'llm';
    const resolved = await resolveTaskClient(provider, model, purpose);
    if (resolved.error) return res.status(409).json({ error: resolved.error });
    const client = resolved.client;
    const text = await client.chat(body.messages, { temperature, maxTokens });
    // Return the subscription SDK's usage (ADR 0066/0069) so the app can persist + surface per-call
    // token/cache/cost. One call per request, so client.lastUsage is this call's usage.
    const usage = client.lastUsage ? { ...client.lastUsage, ms: Date.now() - t0 } : null;
    console.log(`[/llm] ok provider=${provider} model=${model} ${Date.now() - t0}ms textLen=${text.length} cacheRead=${usage?.cache_read_input_tokens ?? 0}`);
    res.json({ text, usage });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[/llm] FAIL provider=${provider} model=${model} ${Date.now() - t0}ms: ${msg}`);
    res.status(500).json({ error: msg });
  }
});

const server = app.listen(PORT, HOST, () => {
  console.log(`résumé worker listening on ${HOST || '*'}:${PORT}`);
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
