/** Shared constants + self-trigger helpers for the decoupled pipeline (ADR 0004). */

/** Jobs scored per /api/score-batch invocation. Keep small to stay under the
 *  serverless timeout given LLM rate limits (Gemini free tier ~15 RPM). */
export const SCORE_BATCH_SIZE = 5;

/** Companies assessed per /api/assess-batch invocation (ADR 0010). */
export const ASSESS_BATCH_SIZE = 5;

/** Base URL of this deployment, used to build self-referential trigger URLs. */
export function appBaseUrl(): string {
  const u = process.env.NEXT_PUBLIC_APP_URL;
  if (u) return u.replace(/\/$/, '');
  // Vercel injects VERCEL_URL (host only) for the current deployment.
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  // Netlify injects URL (full site URL) into the build + function runtime.
  if (process.env.URL) return process.env.URL.replace(/\/$/, '');
  return 'http://localhost:3000';
}

/**
 * Fire-and-forget POST to /api/score-batch to continue the scoring loop without
 * blocking the caller. Authenticated with CRON_SECRET.
 */
export function triggerScoreBatch(): void {
  const secret = process.env.CRON_SECRET || '';
  // Intentionally not awaited — we want the current invocation to return.
  void fetch(`${appBaseUrl()}/api/score-batch`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}` },
  }).catch(() => {
    /* best-effort; the next cron tick / webhook can re-drive if this drops */
  });
}

/**
 * Fire-and-forget POST to /api/assess-batch — the post-scoring company-assessment
 * stage (ADR 0010). Authenticated with CRON_SECRET.
 */
export function triggerAssessBatch(): void {
  const secret = process.env.CRON_SECRET || '';
  void fetch(`${appBaseUrl()}/api/assess-batch`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}` },
  }).catch(() => {
    /* best-effort */
  });
}
