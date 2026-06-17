/** GET /api/runs — ordered list of runs for the Jobs page run selector. */
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const { data, error } = await supabaseAdmin()
    .from('runs')
    .select('id, started_at, finished_at, jobs_found, jobs_scored, status')
    .order('started_at', { ascending: false })
    .limit(60);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ runs: data ?? [] });
}
