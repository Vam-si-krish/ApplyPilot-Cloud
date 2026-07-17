/**
 * PATCH /api/applications/[id]/ai-assignment
 *
 * Guarded lifecycle for the AI Apply Navigator queue (ADRs 0093–0095). The ordinary
 * application PATCH route cannot mutate these fields, keeping browser-workflow state
 * separate from tailoring state and records submission only after visible site success.
 */
import { NextResponse } from 'next/server';
import { type AiApplyAction } from '@/lib/aiApply';
import { mutateAiApplication } from '@/lib/aiApplyServer';
import { supabaseAdmin } from '@/lib/supabase';
import { getSettings } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ACTIONS: AiApplyAction[] = ['assign', 'start', 'ready', 'block', 'retry', 'unassign', 'submitted'];

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  let body: { action?: unknown; reason?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  if (typeof body.action !== 'string' || !ACTIONS.includes(body.action as AiApplyAction)) {
    return NextResponse.json({ error: 'invalid AI assignment action' }, { status: 400 });
  }
  const settings = await getSettings();
  if (!settings.ai_apply_enabled && body.action !== 'unassign') {
    return NextResponse.json({ error: 'Assign to AI is disabled in Settings.' }, { status: 403 });
  }

  const result = await mutateAiApplication(
    supabaseAdmin(), params.id, body.action as AiApplyAction,
    typeof body.reason === 'string' ? body.reason : undefined,
  );
  return NextResponse.json(result.ok ? { ok: true, application: result.application } : { error: result.error }, { status: result.status });
}
