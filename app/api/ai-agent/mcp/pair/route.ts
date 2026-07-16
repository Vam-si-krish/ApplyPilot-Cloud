/** Exchanges a single-use pairing code for a scoped run token directly with the MCP process. */
import { NextResponse } from 'next/server';
import { AI_AGENT_RUN_TTL_MS, createAiAgentToken } from '@/lib/aiAgentAuth';
import { hashAiAgentPairingCode } from '@/lib/aiAgentPairing';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  let code: unknown;
  let clientName: unknown;
  try {
    ({ code, clientName } = await req.json() as { code?: unknown; clientName?: unknown });
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const codeHash = await hashAiAgentPairingCode(code);
  if (!codeHash) return NextResponse.json({ error: 'invalid pairing code' }, { status: 400 });

  // A service-scoped lookup is intentionally limited to the opaque hash. Every later
  // operation re-enters the normal UUID-scoped gateway for the pairing owner.
  const { data: pairing, error: lookupError } = await supabaseAdmin(null)
    .from('ai_agent_pairings')
    .select('id, user_id, expires_at, consumed_at')
    .eq('code_hash', codeHash)
    .maybeSingle();
  if (lookupError) return NextResponse.json({ error: lookupError.message }, { status: 500 });
  if (!pairing || pairing.consumed_at || new Date(pairing.expires_at).getTime() <= Date.now()) {
    return NextResponse.json({ error: 'pairing code is expired or already used' }, { status: 401 });
  }

  const db = supabaseAdmin(pairing.user_id);
  const { data: consumed, error: consumeError } = await db
    .from('ai_agent_pairings')
    .update({ consumed_at: new Date().toISOString() })
    .eq('id', pairing.id)
    .is('consumed_at', null)
    .gt('expires_at', new Date().toISOString())
    .select('id')
    .maybeSingle();
  if (consumeError) return NextResponse.json({ error: consumeError.message }, { status: 500 });
  if (!consumed) return NextResponse.json({ error: 'pairing code is expired or already used' }, { status: 409 });

  const label = typeof clientName === 'string' && clientName.trim()
    ? clientName.replace(/\s+/g, ' ').trim().slice(0, 80)
    : 'Codex MCP';
  const expiresAt = Date.now() + AI_AGENT_RUN_TTL_MS;
  const { data: run, error: runError } = await db
    .from('ai_agent_runs')
    .insert({ label, expires_at: new Date(expiresAt).toISOString() })
    .select('id, label, expires_at, created_at')
    .single();
  if (runError) return NextResponse.json({ error: runError.message }, { status: 500 });

  return NextResponse.json({
    token: await createAiAgentToken(run.id, pairing.user_id, expiresAt),
    expiresAt: new Date(expiresAt).toISOString(),
  }, { status: 201 });
}
