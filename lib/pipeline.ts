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

/**
 * Fire-and-forget POST to /api/score-batch to drive the scoring loop without
 * blocking the caller. Authenticated with CRON_SECRET.
 *
 * No `token` → a START: tries to acquire the single-flight lock (ADR 0028); if a
 * chain is already active it no-ops, so duplicate triggers (multi-portal webhooks,
 * the manual button, overlapping runs) can't double-score. With a `token` → a
 * CONTINUE of that owning session's loop.
 */
export function triggerScoreBatch(token?: string, explicitUserId?: string): void {
  const secret = process.env.CRON_SECRET || '';
  const userId = explicitUserId || currentUserId();
  if (!userId) throw new Error('Cannot trigger scoring without a user context');
  const params = new URLSearchParams({ user_id: userId });
  if (token) params.set('token', token);
  // Intentionally not awaited — we want the current invocation to return.
  void fetch(`${appBaseUrl()}/api/score-batch?${params}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}` },
  }).catch(() => {
    /* best-effort; the next cron tick / webhook can re-drive if this drops */
  });
}
