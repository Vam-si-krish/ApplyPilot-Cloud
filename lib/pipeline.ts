/** Shared constants + self-trigger helpers for the decoupled pipeline (ADR 0004). */
import { currentUserId } from './userContext';

/** Jobs scored per /api/score-batch invocation. Keep small to stay under the
 *  serverless timeout given LLM rate limits (Gemini free tier ~15 RPM). */
export const SCORE_BATCH_SIZE = 5;

export interface AppUrlEnvironment {
  NEXT_PUBLIC_APP_URL?: string;
  VERCEL_URL?: string;
  URL?: string;
}

const PLACEHOLDER_HOSTS = new Set(['your-new-site.netlify.app']);

function normalizedUrl(value: string | undefined): string | null {
  const raw = (value || '').trim().replace(/\/$/, '');
  if (!raw) return null;
  try {
    const url = new URL(raw.includes('://') ? raw : `https://${raw}`);
    if (PLACEHOLDER_HOSTS.has(url.hostname.toLowerCase())) return null;
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

/** Base URL of this deployment, used to build self-referential trigger URLs. */
export function appBaseUrl(env: AppUrlEnvironment = process.env as AppUrlEnvironment): string {
  const configured = normalizedUrl(env.NEXT_PUBLIC_APP_URL);
  if (configured) return configured;
  // Vercel injects VERCEL_URL (host only) for the current deployment.
  const vercel = normalizedUrl(env.VERCEL_URL);
  if (vercel) return vercel;
  // Netlify injects URL (full site URL) into the build + function runtime.
  const netlify = normalizedUrl(env.URL);
  if (netlify) return netlify;
  return 'http://localhost:3000';
}

/** Apify callbacks must never be registered against localhost or a template hostname. */
export function publicWebhookBaseUrl(env: AppUrlEnvironment = process.env as AppUrlEnvironment): string {
  const base = appBaseUrl(env);
  const url = new URL(base);
  if (url.protocol !== 'https:' || url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
    throw new Error(
      'A real public app URL is required before starting Apify. Set NEXT_PUBLIC_APP_URL to this Netlify site URL.',
    );
  }
  return base;
}

/** How long a trigger waits for its request to reach the platform edge before
 *  abandoning the response. The downstream invocation only responds after scoring
 *  a whole batch, so the abort almost always fires — that's expected; by then the
 *  request has been delivered and the next invocation runs independently. */
const TRIGGER_DELIVERY_MS = 3_000;

/**
 * POST to /api/score-batch to drive the scoring loop. Authenticated with CRON_SECRET.
 *
 * No `token` → a START: tries to acquire the single-flight lock (ADR 0028); if a
 * chain is already active it no-ops, so duplicate triggers (multi-portal webhooks,
 * the manual button, overlapping runs) can't double-score. With a `token` → a
 * CONTINUE of that owning session's loop.
 *
 * Serverless platforms freeze the instance the moment the response returns, so a
 * fully fire-and-forget fetch was often never sent — scoring chains died mid-queue
 * with runs stuck 'running' and jobs_scored at a multiple of the batch size
 * (ADR 0111). Callers must now await this: it waits only for request DELIVERY
 * (bounded by TRIGGER_DELIVERY_MS), never for the downstream batch to finish, so
 * the chain stays parallel instead of serializing. The scheduled score-tick
 * watchdog revives anything that still slips through.
 */
export async function triggerScoreBatch(token?: string, explicitUserId?: string): Promise<void> {
  const secret = process.env.CRON_SECRET || '';
  const userId = explicitUserId || currentUserId();
  if (!userId) throw new Error('Cannot trigger scoring without a user context');
  const params = new URLSearchParams({ user_id: userId });
  if (token) params.set('token', token);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TRIGGER_DELIVERY_MS);
  try {
    await fetch(`${appBaseUrl()}/api/score-batch?${params}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}` },
      signal: controller.signal,
    });
  } catch {
    /* The delivery-window abort is the normal path; a genuinely dropped trigger
       is re-driven by the next score-tick. */
  } finally {
    clearTimeout(timer);
  }
}
