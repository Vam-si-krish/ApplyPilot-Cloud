/**
 * GET  /api/company-assessments?key=…&key=… — fetch assessment rows by company key
 *      (repeated params, not comma-joined: normalized keys may contain commas).
 * PATCH /api/company-assessments — set/clear a user override on one company, then
 *      re-stamp that company's jobs. Overrides win over the AI verdict (ADR 0101).
 *
 * Session-gated by middleware like every other /api route.
 */
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { APPLY_CHANNELS, COMPANY_TRUSTS, stampJobsFromAssessments } from '@/lib/companyAssessment';
import type { CompanyAssessment } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const keys = new URL(req.url).searchParams.getAll('key').filter(Boolean);
  if (keys.length === 0) return NextResponse.json({ assessments: [] });
  const { data, error } = await supabaseAdmin()
    .from('company_assessments')
    .select('*')
    .in('company_key', keys.slice(0, 100));
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ assessments: (data ?? []) as CompanyAssessment[] });
}

interface OverridePatch {
  company_key?: string;
  /** A valid value sets the override; explicit null clears it; absent = untouched. */
  override_channel?: string | null;
  override_trust?: string | null;
}

export async function PATCH(req: Request) {
  let body: OverridePatch;
  try {
    body = (await req.json()) as OverridePatch;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const key = (body.company_key ?? '').trim();
  if (!key) return NextResponse.json({ error: 'company_key required' }, { status: 400 });

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if ('override_channel' in body) {
    const v = body.override_channel;
    if (v !== null && !(APPLY_CHANNELS as string[]).includes(v ?? '')) {
      return NextResponse.json({ error: `invalid override_channel: ${v}` }, { status: 400 });
    }
    patch.override_channel = v;
  }
  if ('override_trust' in body) {
    const v = body.override_trust;
    if (v !== null && !(COMPANY_TRUSTS as string[]).includes(v ?? '')) {
      return NextResponse.json({ error: `invalid override_trust: ${v}` }, { status: 400 });
    }
    patch.override_trust = v;
  }
  if (Object.keys(patch).length === 1) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin()
    .from('company_assessments')
    .update(patch)
    .eq('company_key', key)
    .select('*')
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'company not assessed yet' }, { status: 404 });

  // Re-stamp this company's jobs so the list reflects the override immediately.
  const stamped = await stampJobsFromAssessments([key]).catch(() => 0);
  return NextResponse.json({ assessment: data as CompanyAssessment, jobs_updated: stamped });
}
