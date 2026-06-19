/**
 * Netlify Scheduled Function — the daily pipeline trigger (ADR 0020).
 *
 * Netlify ignores vercel.json, so this is what actually fires the run. It just
 * calls the existing /api/run (which starts the Apify scrape async); the webhook →
 * score-batch → assess-batch loops self-drive from there.
 *
 * Schedule: 23:00 UTC = 04:30 IST. (On the free plan, fires within the hour.)
 * Requires env: CRON_SECRET (to authorize) and ideally NEXT_PUBLIC_APP_URL.
 */
export const config = { schedule: '0 23 * * *' };

export default async () => {
  const base = process.env.NEXT_PUBLIC_APP_URL || process.env.URL || '';
  const secret = process.env.CRON_SECRET || '';
  try {
    const res = await fetch(`${base}/api/run`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${secret}` },
    });
    return new Response(`daily-run triggered: HTTP ${res.status}`, { status: 200 });
  } catch (e) {
    return new Response(`daily-run error: ${e instanceof Error ? e.message : e}`, { status: 200 });
  }
};
