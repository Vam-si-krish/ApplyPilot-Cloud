/**
 * POST /api/jobs/recompute-match — recompute the ATS-style match % (ADR 0053)
 * for existing jobs, no re-fetch needed.
 *
 * Session-gated (not in middleware's PUBLIC/SELF_AUTH paths). Runs over every
 * non-archived job (or the ids in the body, when given): pure CPU, no LLM —
 * this never touches fit_score. Use after editing the résumé / Settings→Skills,
 * or after the scoring algorithm changes.
 */
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getScoringResumeText, getSettings } from '@/lib/db';
import { atsMatchScores } from '@/lib/prefilter';

export const runtime = 'nodejs';
export const maxDuration = 60;

const tag = '[recompute-match]';

export async function POST(req: Request) {
  let ids: string[] = [];
  try {
    const body = (await req.json().catch(() => ({}))) as { ids?: unknown };
    if (Array.isArray(body.ids)) ids = body.ids.filter((x): x is string => typeof x === 'string');
  } catch {
    /* empty body = all jobs */
  }

  try {
    const resume = await getScoringResumeText().catch(() => '');
    if (!resume.trim()) {
      return NextResponse.json({ error: 'No résumé on the Profile page — nothing to match against.' }, { status: 409 });
    }
    const skills = await getSettings().then((s) => s.skills ?? []).catch(() => [] as string[]);

    // Page through the target jobs (id/title/description only — keep memory sane).
    type Row = { id: string; title: string | null; full_description: string | null };
    const rows: Row[] = [];
    const PAGE = 500;
    for (let from = 0; ; from += PAGE) {
      let q = supabaseAdmin().from('jobs').select('id,title,full_description').neq('status', 'archived');
      if (ids.length > 0) q = q.in('id', ids);
      const { data, error } = await q.order('id').range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      rows.push(...((data ?? []) as Row[]));
      if (!data || data.length < PAGE) break;
    }
    if (rows.length === 0) return NextResponse.json({ ok: true, updated: 0 });

    const scores = atsMatchScores(
      { text: resume, skills },
      rows.map((r) => ({ id: r.id, title: r.title ?? '', text: r.full_description ?? '' })),
    );

    let updated = 0;
    for (const r of rows) {
      const s = scores.get(r.id);
      if (!s) continue;
      const { error } = await supabaseAdmin()
        .from('jobs')
        .update({ prefilter_score: s.score, prefilter_breakdown: s.breakdown })
        .eq('id', r.id);
      if (error) throw new Error(error.message);
      updated++;
    }

    console.log(tag, `updated=${updated} of ${rows.length}`);
    return NextResponse.json({ ok: true, updated });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(tag, msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
