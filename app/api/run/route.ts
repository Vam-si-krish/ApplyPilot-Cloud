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
import { startAllPortalRuns, estimateRunCostUsd } from '@/lib/apify';
import { rotateAllActiveKeys, ensureApifyKeyWithCredit } from '@/lib/credentials';
import { getSettings, createRun, getLatestRun } from '@/lib/db';
import { checkCronAuth, configuredUsers, readSessionToken, SESSION_COOKIE } from '@/lib/auth';
import { publicWebhookBaseUrl } from '@/lib/pipeline';
import { cookies } from 'next/headers';
import { runAsUser } from '@/lib/userContext';

export const runtime = 'nodejs';
export const maxDuration = 30;

/** Re-running inside this window re-bills the same look-back window (ADR 0058). */
const RUN_COOLDOWN_HOURS = 12;

async function handleForUser(req: Request, userId: string, cron: boolean, force: boolean) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  }

  try {
    const settings = await getSettings();

    // If triggered by cron and auto_scrape is disabled, skip running
    if (cron && settings.auto_scrape_enabled === false) {
      return NextResponse.json({ ok: true, skipped: true, reason: 'auto_scrape_enabled is false' });
    }

    // Cooldown guard (ADR 0058): the actor bills per result, so a second run inside
    // the look-back window mostly re-buys jobs we already have (the Jun 20 triple-run
    // cost ~3× one run). Manual override: POST {"force":true} or ?force=1.
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

    // Resolve this before rotating keys or starting billable actors. Placeholder or
    // local callback targets must fail visibly instead of producing stuck runs.
    const webhookBase = publicWebhookBaseUrl();

    // Auto-rotate (ADR 0007): advance each provider's active key once, before the
    // run reads the Apify token (here) or the LLM key (later, in /api/score-batch).
    if (settings.auto_rotate_keys) await rotateAllActiveKeys();

    // Never start a run on an Apify account that can't afford the WHOLE fetch
    // (free keys cap at $5/month; a mid-scrape stop wastes the partial spend) —
    // low keys are parked until their cycle reset, the next funded key activates,
    // and when all are dry we fail loudly (ADR 0058/0059).
    const key = await ensureApifyKeyWithCredit(estimateRunCostUsd(settings));
    if (!key.vaultEmpty && key.label === null) {
      return NextResponse.json(
        { error: 'Every Apify key in the vault is out of credit for a full fetch — all parked until their monthly resets. Add a key or lower Max jobs/run.' },
        { status: 402 },
      );
    }

    const webhookUrl = `${webhookBase}/api/apify-webhook?secret=${encodeURIComponent(secret)}&user_id=${encodeURIComponent(userId)}`;
    // Start one actor per enabled portal in parallel; create a run row per actor.
    const runs = await startAllPortalRuns(settings, webhookUrl);
    await Promise.all(runs.map((r) => createRun(r.runId, r.apiKeyId)));
    return NextResponse.json({ ok: true, apify_run_ids: runs.map((r) => r.runId) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

async function handle(req: Request) {
  const session = await readSessionToken(cookies().get(SESSION_COOKIE)?.value);
  const cron = checkCronAuth(req);
  if (!cron && !session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const force = new URL(req.url).searchParams.get('force') === '1' || (await readForce(req));
  if (session) return runAsUser(session.userId, () => handleForUser(req, session.userId, false, force));

  const requested = new URL(req.url).searchParams.get('user_id');
  const users = configuredUsers().filter((user) => !requested || user.id === requested);
  if (users.length === 0) return NextResponse.json({ error: 'unknown user' }, { status: 400 });
  const results = [];
  for (const user of users) {
    const response = await runAsUser(user.id, () => handleForUser(req, user.id, true, force));
    results.push({ user_id: user.id, status: response.status, body: await response.json() });
  }
  return NextResponse.json({ ok: results.every((result) => result.status < 400), results });
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
