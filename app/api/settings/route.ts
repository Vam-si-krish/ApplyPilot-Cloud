/** GET/PUT /api/settings — the single-row app settings (id=1). */
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSettings } from '@/lib/db';

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
  if (Number.isFinite(Number(body.hours_old))) patch.hours_old = Math.max(1, Math.round(Number(body.hours_old)));
  if (Number.isFinite(Number(body.results_per_query))) patch.results_per_query = Math.max(1, Math.round(Number(body.results_per_query)));
  if (typeof body.llm_provider === 'string' && body.llm_provider) patch.llm_provider = body.llm_provider;
  if (typeof body.llm_model === 'string' && body.llm_model) patch.llm_model = body.llm_model;
  if (typeof body.apify_actor_id === 'string' && body.apify_actor_id) patch.apify_actor_id = body.apify_actor_id.replace(/\//g, '~');
  if (typeof body.auto_scrape_enabled === 'boolean') patch.auto_scrape_enabled = body.auto_scrape_enabled;

  const { error } = await supabaseAdmin().from('settings').update(patch).eq('id', 1);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
