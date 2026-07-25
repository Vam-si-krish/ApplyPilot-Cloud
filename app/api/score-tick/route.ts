/**
 * /api/score-tick — cron-driven watchdog for the scoring pipeline (ADR 0111).
 *
 * A serverless self-trigger can still drop, leaving unscored jobs orphaned and
 * runs stuck 'running'. Every tick walks all configured users:
 *   - unscored jobs waiting + no live chain (lock free or heartbeat stale) →
 *     START a chain (the START path takes over stale locks atomically, ADR 0028);
 *   - live chain → leave it alone (a START would only set a needless rescan flag);
 *   - queue empty → close out any idle 'running' runs.
 *
 * Authorized by CRON_SECRET; a Netlify scheduled function fires it every few
 * minutes. When the pipeline is healthy each tick is one COUNT query per user.
 */
import { NextResponse } from 'next/server';
import { checkCronAuth, configuredUsers } from '@/lib/auth';
import { runAsUser } from '@/lib/userContext';
import { countUnscored, finalizeIdleRuns, getScoringState, isScoringStale } from '@/lib/db';
import { triggerScoreBatch } from '@/lib/pipeline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

async function handle(req: Request) {
  if (!checkCronAuth(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const results: Array<{ user_id: string; unscored: number; kicked?: boolean }> = [];
  for (const user of configuredUsers()) {
    await runAsUser(user.id, async () => {
      const unscored = await countUnscored().catch(() => 0);
      if (unscored === 0) {
        await finalizeIdleRuns().catch(() => {});
        results.push({ user_id: user.id, unscored });
        return;
      }
      const state = await getScoringState().catch(() => null);
      const chainAlive = !!state?.active && !isScoringStale(state);
      if (!chainAlive) await triggerScoreBatch(undefined, user.id);
      results.push({ user_id: user.id, unscored, kicked: !chainAlive });
    });
  }
  return NextResponse.json({ ok: true, results });
}

export const GET = handle;
export const POST = handle;
