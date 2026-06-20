/** GET/PUT /api/settings — the single-row app settings (id=1). */
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSettings } from '@/lib/db';
import { SUPPORTED_PORTALS } from '@/lib/apify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json(await getSettings());
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

  // Validate + coerce each field defensively (these drive the daily run).
  if (typeof body.schedule_time === 'string' && /^\d{2}:\d{2}$/.test(body.schedule_time)) patch.schedule_time = body.schedule_time;
  if (typeof body.timezone === 'string' && body.timezone) patch.timezone = body.timezone;
  if (Array.isArray(body.keywords)) patch.keywords = (body.keywords as unknown[]).map(String).filter(Boolean);
  if (Array.isArray(body.locations)) patch.locations = (body.locations as unknown[]).map(String).filter(Boolean);
  // Saved libraries (ADR 0016) — de-duped, order-preserving.
  if (Array.isArray(body.keyword_options)) {
    patch.keyword_options = [...new Set((body.keyword_options as unknown[]).map(String).filter(Boolean))];
  }
  if (Array.isArray(body.location_options)) {
    patch.location_options = [...new Set((body.location_options as unknown[]).map(String).filter(Boolean))];
  }
  // Skills to match each job against (ADR 0018) — de-duped.
  if (Array.isArray(body.skills)) {
    patch.skills = [...new Set((body.skills as unknown[]).map(String).map((s) => s.trim()).filter(Boolean))];
  }
  if (Number.isFinite(Number(body.hours_old))) patch.hours_old = Math.max(1, Math.round(Number(body.hours_old)));
  if (Number.isFinite(Number(body.results_per_query))) patch.results_per_query = Math.max(1, Math.round(Number(body.results_per_query)));
  // Per-location jobs-per-role overrides (ADR 0015): keep only positive-int entries.
  if (body.location_limits && typeof body.location_limits === 'object' && !Array.isArray(body.location_limits)) {
    const out: Record<string, number> = {};
    for (const [loc, raw] of Object.entries(body.location_limits as Record<string, unknown>)) {
      const n = Number(raw);
      if (loc && Number.isFinite(n) && n > 0) out[loc] = Math.round(n);
    }
    patch.location_limits = out;
  }
  if (typeof body.llm_provider === 'string' && body.llm_provider) patch.llm_provider = body.llm_provider;
  if (typeof body.llm_model === 'string' && body.llm_model) patch.llm_model = body.llm_model;
  if (typeof body.apify_actor_id === 'string' && body.apify_actor_id) patch.apify_actor_id = body.apify_actor_id.replace(/\//g, '~');
  if (Array.isArray(body.job_portals)) {
    const valid = (body.job_portals as unknown[]).map(String).filter((p) => SUPPORTED_PORTALS.includes(p));
    if (valid.length > 0) patch.job_portals = valid;
  }
  if (typeof body.auto_scrape_enabled === 'boolean') patch.auto_scrape_enabled = body.auto_scrape_enabled;
  if (typeof body.auto_rotate_keys === 'boolean') patch.auto_rotate_keys = body.auto_rotate_keys;
  if (typeof body.prefilter_enabled === 'boolean') patch.prefilter_enabled = body.prefilter_enabled;
  if (Number.isFinite(Number(body.prefilter_threshold))) {
    patch.prefilter_threshold = Math.max(0, Math.min(100, Math.round(Number(body.prefilter_threshold))));
  }
  if (Number.isFinite(Number(body.min_skill_match))) {
    patch.min_skill_match = Math.max(0, Math.min(100, Math.round(Number(body.min_skill_match))));
  }
  if (Number.isFinite(Number(body.max_jobs_per_run))) {
    patch.max_jobs_per_run = Math.max(0, Math.round(Number(body.max_jobs_per_run)));
  }
  if (body.fetch_mode === 'url' || body.fetch_mode === 'keyword') patch.fetch_mode = body.fetch_mode;
  if (typeof body.auto_assess_enabled === 'boolean') patch.auto_assess_enabled = body.auto_assess_enabled;
  if (Number.isFinite(Number(body.auto_assess_min_score))) {
    patch.auto_assess_min_score = Math.max(0, Math.min(10, Math.round(Number(body.auto_assess_min_score))));
  }

  const { error } = await supabaseAdmin().from('settings').update(patch).eq('id', 1);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
