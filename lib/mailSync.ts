/**
 * Two-phase Gmail sync engine (ADR 0013).
 *
 * The old sync fetched + classified + advanced last_synced_at in one capped pass,
 * which stranded any backlog beyond the cap. This splits it:
 *   1. fetchChunk  — pull a chunk of NEW message metadata into the DB as 'pending'.
 *                    last_synced_at only advances once the whole window is stored.
 *   2. classifyChunk — AI-label a chunk of pending messages.
 *
 * Each phase is chunked and idempotent (de-duped by gmail_id / drained by status),
 * so the UI can drive it call-by-call with live progress, and the cron can finish
 * it headlessly. Classification is a SEPARATE LLM call (frozen SCORE_PROMPT
 * untouched — CLAUDE.md invariant).
 */
import {
  getGmailConnection,
  updateGmailConnection,
  existingGmailIds,
  insertFetchedMail,
  getPendingMailBatch,
  countPendingMail,
  setMailClassification,
  getSettings,
  type FetchedMailRow,
} from './db';
import { getAccessToken, listAllMessageIds, getMessage } from './gmail';
import { classifyEmail, domainApplySource } from './mailClassify';
import { buildScoringClient } from './scoreRunner';
import { getClient } from './llm';
import type { GmailConnection } from './types';

/** Messages whose metadata we pull per fetch invocation (cheap HTTP, no LLM). */
export const MAIL_FETCH_BATCH = 25;
/** Messages we AI-classify per classify invocation (one LLM call each). */
export const MAIL_CLASSIFY_BATCH = 8;
/** Hard ceiling on ids pulled for one look-back window (≈5 Gmail pages). */
export const MAIL_LIST_CAP = 500;

export interface GmailContext {
  conn: GmailConnection;
  accessToken: string;
}

/** Resolve the connection + a fresh access token, or a reason it can't run. */
export async function resolveGmailContext(): Promise<{ ctx?: GmailContext; reason?: 'not_connected' }> {
  const conn = await getGmailConnection();
  if (!conn.client_id || !conn.client_secret || !conn.refresh_token) return { reason: 'not_connected' };
  const accessToken = await getAccessToken(conn.client_id, conn.client_secret, conn.refresh_token);
  return { ctx: { conn, accessToken } };
}

export interface FetchResult {
  done: boolean; // true once the whole look-back window is stored
  fetched: number; // newly stored this call
  found: number; // total ids matched in the window
  remainingFetch: number; // fresh ids still to pull after this call
  pending: number; // total messages awaiting classification
}

/**
 * Pull one chunk of new message metadata into the DB as 'pending'. Re-listing the
 * window each call is cheap and keeps the function stateless; de-dup by gmail_id
 * means re-runs only ever pick up what's left. last_synced_at advances only when
 * nothing fresh remains, so the backlog is never skipped.
 */
export async function fetchChunk(ctx: GmailContext): Promise<FetchResult> {
  const { conn, accessToken } = ctx;

  // First sync: last 3 days. Thereafter: everything since the last sync (with a
  // 1h buffer for clock skew / mail that lands out of order).
  let query = 'newer_than:3d';
  if (conn.last_synced_at) {
    const since = Math.floor(new Date(conn.last_synced_at).getTime() / 1000) - 3600;
    query = `after:${since}`;
  }

  const allIds = await listAllMessageIds(accessToken, query, MAIL_LIST_CAP);
  const existing = await existingGmailIds(allIds);
  const freshIds = allIds.filter((id) => !existing.has(id));

  if (freshIds.length === 0) {
    await updateGmailConnection({ last_synced_at: new Date().toISOString() });
    return { done: true, fetched: 0, found: allIds.length, remainingFetch: 0, pending: await countPendingMail() };
  }

  const chunk = freshIds.slice(0, MAIL_FETCH_BATCH);
  const rows: FetchedMailRow[] = [];
  for (const id of chunk) {
    try {
      const m = await getMessage(accessToken, id);
      rows.push({
        gmail_id: m.id,
        thread_id: m.threadId,
        received_at: m.receivedAt,
        from_email: m.fromEmail,
        from_name: m.fromName,
        subject: m.subject,
        snippet: m.snippet,
      });
    } catch {
      /* skip one bad message rather than abort the whole batch */
    }
  }

  const fetched = await insertFetchedMail(rows);
  const remainingFetch = freshIds.length - chunk.length;
  if (remainingFetch === 0) await updateGmailConnection({ last_synced_at: new Date().toISOString() });

  return { done: remainingFetch === 0, fetched, found: allIds.length, remainingFetch, pending: await countPendingMail() };
}

export interface ClassifyResult {
  classified: number; // labeled this call
  remaining: number; // pending after this call
  done: boolean; // nothing left to classify
}

/** AI-classify one chunk of pending messages. One LLM call per message. */
export async function classifyChunk(): Promise<ClassifyResult> {
  const batch = await getPendingMailBatch(MAIL_CLASSIFY_BATCH);
  if (batch.length === 0) return { classified: 0, remaining: 0, done: true };

  const settings = await getSettings();
  const client = (await buildScoringClient(settings)) ?? getClient();

  let classified = 0;
  for (const m of batch) {
    const { category, summary, apply_source } = await classifyEmail(
      { from: `${m.from_name ?? ''} <${m.from_email ?? ''}>`, subject: m.subject ?? '', snippet: m.snippet ?? '' },
      client,
    );
    // apply_source only applies to submitted applications. Trust the sender domain
    // first (job board → easy_apply, ATS → company_portal); fall back to the AI.
    const source = category === 'applied' ? domainApplySource(m.from_email) ?? apply_source ?? null : null;
    await setMailClassification(m.id, category, summary, source);
    classified++;
  }

  const remaining = await countPendingMail();
  return { classified, remaining, done: remaining === 0 };
}
