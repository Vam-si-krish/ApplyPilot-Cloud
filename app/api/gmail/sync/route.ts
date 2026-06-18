/**
 * POST/GET /api/gmail/sync — fetch new Gmail messages, classify each into a
 * job-search category, and store them (ADR 0012). Triggered by cron (GET, with
 * CRON_SECRET) and by the "Sync now" button (POST, session). De-duped by gmail_id;
 * capped per run to stay under the serverless timeout.
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { checkCronAuth, verifySessionToken, SESSION_COOKIE } from '@/lib/auth';
import { getGmailConnection, updateGmailConnection, existingGmailIds, insertMailMessages, getSettings } from '@/lib/db';
import { getAccessToken, listMessageIds, getMessage } from '@/lib/gmail';
import { classifyEmail } from '@/lib/mailClassify';
import { buildScoringClient } from '@/lib/scoreRunner';
import { getClient } from '@/lib/llm';

export const runtime = 'nodejs';
export const maxDuration = 60;

const PER_RUN = 15; // classify at most this many new emails per invocation

async function handle(req: Request) {
  const sessionOk = await verifySessionToken(cookies().get(SESSION_COOKIE)?.value);
  if (!checkCronAuth(req) && !sessionOk) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const conn = await getGmailConnection();
  if (!conn.client_id || !conn.client_secret || !conn.refresh_token) {
    return NextResponse.json({ ok: false, reason: 'not_connected' });
  }

  try {
    const accessToken = await getAccessToken(conn.client_id, conn.client_secret, conn.refresh_token);

    // Look back from the last sync (with a buffer); default to the last 3 days.
    let query = 'newer_than:3d';
    if (conn.last_synced_at) {
      const since = Math.floor(new Date(conn.last_synced_at).getTime() / 1000) - 3600;
      query = `after:${since}`;
    }

    const ids = await listMessageIds(accessToken, query, 50);
    const existing = await existingGmailIds(ids);
    const fresh = ids.filter((id) => !existing.has(id)).slice(0, PER_RUN);

    if (fresh.length === 0) {
      await updateGmailConnection({ last_synced_at: new Date().toISOString() });
      return NextResponse.json({ ok: true, classified: 0 });
    }

    const settings = await getSettings();
    const client = (await buildScoringClient(settings)) ?? getClient();

    const rows = [];
    for (const id of fresh) {
      const msg = await getMessage(accessToken, id);
      const { category, summary } = await classifyEmail(
        { from: `${msg.fromName ?? ''} <${msg.fromEmail ?? ''}>`, subject: msg.subject ?? '', snippet: msg.snippet },
        client,
      );
      rows.push({
        gmail_id: msg.id,
        thread_id: msg.threadId,
        received_at: msg.receivedAt,
        from_email: msg.fromEmail,
        from_name: msg.fromName,
        subject: msg.subject,
        snippet: msg.snippet,
        category,
        summary,
      });
    }

    const inserted = await insertMailMessages(rows);
    await updateGmailConnection({ last_synced_at: new Date().toISOString() });
    return NextResponse.json({ ok: true, classified: inserted, scanned: ids.length });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
