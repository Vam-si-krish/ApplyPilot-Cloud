/**
 * Netlify Scheduled Function — scoring-pipeline watchdog (ADR 0111).
 *
 * The score-batch chain self-drives with short-lived serverless triggers that can
 * drop; this tick calls /api/score-tick, which revives stalled chains (stale-lock
 * takeover) and closes out idle 'running' runs for every configured user. When
 * the pipeline is healthy the tick is a cheap no-op.
 *
 * Requires env: CRON_SECRET (to authorize) and ideally NEXT_PUBLIC_APP_URL.
 */
export const config = { schedule: '*/5 * * * *' };

export default async () => {
  const base = process.env.NEXT_PUBLIC_APP_URL || process.env.URL || '';
  const secret = process.env.CRON_SECRET || '';
  try {
    const res = await fetch(`${base}/api/score-tick`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}` },
    });
    return new Response(`score-tick triggered: HTTP ${res.status}`, { status: 200 });
  } catch (e) {
    return new Response(`score-tick error: ${e instanceof Error ? e.message : e}`, { status: 200 });
  }
};
