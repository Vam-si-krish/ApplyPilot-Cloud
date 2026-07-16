/** Session-gated creation of a single-use MCP pairing code. */
import { NextResponse } from 'next/server';
import {
  AI_AGENT_PAIRING_TTL_MS,
  createAiAgentPairingCode,
  hashAiAgentPairingCode,
} from '@/lib/aiAgentPairing';
import { supabaseAdmin } from '@/lib/supabase';
import { currentUserId } from '@/lib/userContext';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  const userId = currentUserId();
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const db = supabaseAdmin(userId);
  const now = new Date().toISOString();
  await db.from('ai_agent_pairings').update({ consumed_at: now }).is('consumed_at', null);

  const code = createAiAgentPairingCode();
  const codeHash = await hashAiAgentPairingCode(code);
  const expiresAt = new Date(Date.now() + AI_AGENT_PAIRING_TTL_MS).toISOString();
  const { error } = await db.from('ai_agent_pairings').insert({ code_hash: codeHash, expires_at: expiresAt });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ code, expiresAt }, { status: 201 });
}
