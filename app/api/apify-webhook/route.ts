/**
 * POST /api/apify-webhook — Apify calls this when an actor run finishes.
 *
 * Ingests the run's dataset into Supabase as status='unscored' (de-duped by
 * url), records jobs_found on the run, then kicks off chunked scoring. The
 * webhook URL carries ?secret=CRON_SECRET, which is how we authorize it.
 */
import { NextResponse } from 'next/server';
import { checkCronAuth } from '@/lib/auth';
import { fetchDatasetItems, getRunDatasetId, mapDatasetItemToJob } from '@/lib/apify';
import { supabaseAdmin } from '@/lib/supabase';
import { updateRunByApifyId, finalizeRun, getLatestRunningRun, getRunByApifyId, getScoringResumeText, getSettings, linkDuplicateJobs } from '@/lib/db';
import { atsMatchScores } from '@/lib/prefilter';
import { jobContentKey } from '@/lib/dedupe';
import { triggerScoreBatch } from '@/lib/pipeline';

export const runtime = 'nodejs';
export const maxDuration = 60;

interface WebhookBody {
  eventType?: string;
  eventData?: { actorRunId?: string };
  resource?: { id?: string; defaultDatasetId?: string; status?: string };
}

export async function POST(req: Request) {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: WebhookBody;
  try {
    body = (await req.json()) as WebhookBody;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const runId = body.resource?.id || body.eventData?.actorRunId || null;
  const eventType = body.eventType || '';

  // Non-success terminal events: mark the run failed and stop.
  if (eventType && eventType !== 'ACTOR.RUN.SUCCEEDED') {
    if (runId) await updateRunByApifyId(runId, { status: 'failed', finished_at: new Date().toISOString() });
    return NextResponse.json({ ok: true, ignored: eventType });
  }

  try {
    const datasetId = body.resource?.defaultDatasetId || (runId ? await getRunDatasetId(runId) : null);
    if (!datasetId) {
      return NextResponse.json({ error: 'no dataset id' }, { status: 400 });
    }

    const items = await fetchDatasetItems(datasetId);
    // ?portal= is set by startAllPortalRuns; defaults to 'linkedin' for backward compat.
    const portal = new URL(req.url).searchParams.get('portal') || 'linkedin';
    const source = `apify:${portal}`;

    // Resolve the internal run UUID so jobs can be grouped by run in the UI.
    const internalRun = runId ? await getRunByApifyId(runId).catch(() => null) : null;
    const internalRunId = internalRun?.id ?? null;

    const mapped = items
      .map((it) => mapDatasetItemToJob(it, source))
      .filter((r): r is NonNullable<typeof r> => r !== null);

    // Cheap, local ATS-style résumé↔job match score (ADR 0053), computed once over
    // this batch. Stored on every row (even when the filter is off) — it's the
    // user's first filter; /api/score-batch also uses it to gate the LLM. Keyed by
    // url since rows are new.
    const resume = await getScoringResumeText().catch(() => '');
    const skills = await getSettings().then((s) => s.skills ?? []).catch(() => [] as string[]);
    const scores = atsMatchScores(
      { text: resume, skills },
      mapped.map((r) => ({ id: r.url, title: r.title ?? '', text: r.full_description ?? '' })),
    );

    const rows = mapped.map((r) => ({
      ...r,
      status: 'unscored' as const,
      run_id: internalRunId,
      prefilter_score: scores.get(r.url)?.score ?? null,
      prefilter_breakdown: scores.get(r.url)?.breakdown ?? null,
      // Content fingerprint (ADR 0057): multi-location blasts and daily reposts share
      // a key even though every copy carries a fresh URL.
      content_key: jobContentKey(r.company, r.title, r.full_description),
    }));

    let inserted = 0;
    if (rows.length) {
      // De-dupe by url; ignore rows that already exist.
      const { data, error } = await supabaseAdmin()
        .from('jobs')
        .upsert(rows, { onConflict: 'url', ignoreDuplicates: true })
        .select('id');
      if (error) throw new Error(error.message);
      inserted = data?.length ?? 0;

      // Link duplicate postings (ADR 0057): later copies point at the first-seen
      // canonical and inherit its AI score when it's already scored — they leave the
      // unscored queue without an LLM call.
      const linked = await linkDuplicateJobs(rows.map((r) => r.content_key)).catch((e) => {
        console.error('[apify-webhook] duplicate linking failed:', e instanceof Error ? e.message : String(e));
        return 0;
      });
      if (linked > 0) console.log(`[apify-webhook] linked ${linked} duplicate posting(s)`);
    }

    if (runId) await updateRunByApifyId(runId, { jobs_found: inserted });

    if (inserted > 0) {
      triggerScoreBatch();
    } else if (runId) {
      // Nothing to score — close the run out now.
      await finalizeRun((await getLatestRunningRun())?.id ?? '', 'succeeded').catch(() => {});
    }

    return NextResponse.json({ ok: true, found: items.length, inserted });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (runId) await updateRunByApifyId(runId, { status: 'failed', finished_at: new Date().toISOString() }).catch(() => {});
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
