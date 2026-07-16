/** Session-gated creation/listing/revocation of short-lived ApplyPilot MCP runs. */
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { currentUserId } from '@/lib/userContext';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const userId = currentUserId();
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { data, error } = await supabaseAdmin(userId)
    .from('ai_agent_runs')
    .select('id, label, expires_at, revoked_at, last_used_at, created_at')
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ runs: data ?? [] });
}

export async function DELETE(req: Request) {
  const userId = currentUserId();
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  let id: unknown;
  try {
    ({ id } = await req.json() as { id?: unknown });
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  if (typeof id !== 'string') return NextResponse.json({ error: 'run id is required' }, { status: 400 });
  const { data, error } = await supabaseAdmin(userId)
    .from('ai_agent_runs')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
    .select('id')
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
