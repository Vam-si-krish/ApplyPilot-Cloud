/**
 * Netlify Scheduled Function — Gmail inbox sync (ADR 0020).
 *
 * Calls /api/gmail/sync (fetch + classify new mail). Every 30 minutes.
 * Requires env: CRON_SECRET, and ideally NEXT_PUBLIC_APP_URL.
 */
export const config = { schedule: '*/30 * * * *' };

export default async () => {
  const base = process.env.NEXT_PUBLIC_APP_URL || process.env.URL || '';
  const secret = process.env.CRON_SECRET || '';
  try {
    const res = await fetch(`${base}/api/gmail/sync`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${secret}` },
    });
    return new Response(`gmail-sync triggered: HTTP ${res.status}`, { status: 200 });
  } catch (e) {
    return new Response(`gmail-sync error: ${e instanceof Error ? e.message : e}`, { status: 200 });
  }
};
