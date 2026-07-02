/**
 * /api/run — start a daily (or manual) discovery run.
 *
 * Starts the Apify actor ASYNC and registers a webhook; never blocks on the
 * scrape (ADR 0004).
 *
 * - GET  is how Vercel Cron triggers it (cron sends Authorization: Bearer
 *   CRON_SECRET automatically when CRON_SECRET is set).
 * - POST is the manual "Run now" button (authorized by the session cookie).
 */
import { NextResponse } from 'next/server';
import { startAllPortalRuns } from '@/lib/apify';
import { rotateAllActiveKeys, ensureApifyKeyWithCredit } from '@/lib/credentials';
import { getSettings, createRun, getLatestRun } from '@/lib/db';
import { checkCronAuth, verifySessionToken, SESSION_COOKIE } from '@/lib/auth';
import { appBaseUrl } from '@/lib/pipeline';
import { cookies } from 'next/headers';

export const runtime = 'nodejs';
export const maxDuration = 30;

/** Re-running inside this window re-bills the same look-back window (ADR 0058). */
const RUN_COOLDOWN_HOURS = 12;

async function handle(req: Request) {
  const sessionOk = await verifySessionToken(cookies().get(SESSION_COOKIE)?.value);
  if (!checkCronAuth(req) && !sessionOk) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  }

  try {
    const settings = await getSettings();

    // If triggered by cron and auto_scrape is disabled, skip running
    if (checkCronAuth(req) && settings.auto_scrape_enabled === false) {
      return NextResponse.json({ ok: true, skipped: true, reason: 'auto_scrape_enabled is false' });
    }

    // Cooldown guard (ADR 0058): the actor bills per result, so a second run inside
    // the look-back window mostly re-buys jobs we already have (the Jun 20 triple-run
    // cost ~3× one run). Manual override: POST {"force":true} or ?force=1.
    const force = new URL(req.url).searchParams.get('force') === '1' || (await readForce(req));
    if (!force) {
      const last = await getLatestRun();
      const startedMs = last?.started_at ? new Date(last.started_at).getTime() : NaN;
      const ageH = (Date.now() - startedMs) / 3_600_000;
      if (Number.isFinite(ageH) && ageH < RUN_COOLDOWN_HOURS && last?.status !== 'failed') {
        return NextResponse.json({
          ok: true,
          skipped: true,
          cooldown: true,
          reason: `Last fetch started ${ageH.toFixed(1)}h ago — jobs are billed per result, so re-running now would re-buy mostly the same ${settings.hours_old}h window. Re-run with force to override.`,
        });
      }
    }

    // Auto-rotate (ADR 0007): advance each provider's active key once, before the
    // run reads the Apify token (here) or the LLM key (later, in /api/score-batch).
    if (settings.auto_rotate_keys) await rotateAllActiveKeys();

    // Never start a run on an exhausted Apify account (free keys cap at $5/month) —
    // pick the next vault key with credit, or fail loudly when all are dry (ADR 0058).
    const key = await ensureApifyKeyWithCredit();
    if (!key.vaultEmpty && key.label === null) {
      return NextResponse.json(
        { error: 'Every Apify key in the vault has exhausted its monthly credit — add a key or wait for the cycle reset.' },
        { status: 402 },
      );
    }

    const webhookUrl = `${appBaseUrl()}/api/apify-webhook?secret=${encodeURIComponent(secret)}`;
    // Start one actor per enabled portal in parallel; create a run row per actor.
    const runs = await startAllPortalRuns(settings, webhookUrl);
    await Promise.all(runs.map((r) => createRun(r.runId)));
    return NextResponse.json({ ok: true, apify_run_ids: runs.map((r) => r.runId) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** True when a POST body carries {"force": true}; tolerant of empty/non-JSON bodies. */
async function readForce(req: Request): Promise<boolean> {
  if (req.method !== 'POST') return false;
  try {
    const body = (await req.json()) as { force?: unknown };
    return body?.force === true;
  } catch {
    return false;
  }
}

export const GET = handle;
export const POST = handle;
