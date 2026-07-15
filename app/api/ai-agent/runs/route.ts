/** Session-gated creation/listing/revocation of short-lived ApplyPilot MCP runs. */
import { NextResponse } from 'next/server';
import { AI_AGENT_RUN_TTL_MS, createAiAgentToken } from '@/lib/aiAgentAuth';
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

export async function POST(req: Request) {
  const userId = currentUserId();
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let label = 'Codex MCP';
  try {
    const body = await req.json() as { label?: unknown };
    if (typeof body.label === 'string' && body.label.trim()) label = body.label.replace(/\s+/g, ' ').trim().slice(0, 80);
  } catch {
    // An empty body uses the default label.
  }

  const expiresAt = Date.now() + AI_AGENT_RUN_TTL_MS;
  const { data, error } = await supabaseAdmin(userId)
    .from('ai_agent_runs')
    .insert({ label, expires_at: new Date(expiresAt).toISOString() })
    .select('id, label, expires_at, created_at')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const token = await createAiAgentToken(data.id, userId, expiresAt);
  return NextResponse.json({
    run: data,
    token,
    expiresAt: new Date(expiresAt).toISOString(),
    warning: 'This token is shown once. It can read your application context and update only your AI Apply queue.',
  }, { status: 201 });
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
