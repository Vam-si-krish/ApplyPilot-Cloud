/**
 * PATCH /api/applications/[id]/ai-assignment
 *
 * Guarded lifecycle for the AI Apply Navigator queue (ADRs 0093–0095). The ordinary
 * application PATCH route cannot mutate these fields, keeping browser-workflow state
 * separate from tailoring state and records submission only after visible site success.
 */
import { NextResponse } from 'next/server';
import {
  aiApplyReadiness,
  resolveAiApplyTransition,
  type AiApplyAction,
  AI_APPLY_STATUSES,
} from '@/lib/aiApply';
import { supabaseAdmin } from '@/lib/supabase';
import type { AiApplyStatus, ApplicationWithJob } from '@/lib/types';

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

  const { data, error } = await supabaseAdmin()
    .from('applications')
    .select(
      'id, job_id, status, applied_at, pdf_path, has_resume, ai_apply_status, ai_assigned_at, ai_apply_updated_at, ai_block_reason, parked, ' +
        'job:jobs(id, title, company, url, application_url, easy_apply)',
    )
    .eq('id', params.id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const application = data as unknown as ApplicationWithJob;
  const current =
    typeof application.ai_apply_status === 'string' && AI_APPLY_STATUSES.includes(application.ai_apply_status as AiApplyStatus)
      ? (application.ai_apply_status as AiApplyStatus)
      : null;
  const action = body.action as AiApplyAction;

  if (action === 'assign' || action === 'retry') {
    const readiness = aiApplyReadiness(application);
    if (!readiness.eligible) {
      return NextResponse.json({ error: readiness.reason }, { status: 409 });
    }
  }

  const now = new Date().toISOString();
  const transition = resolveAiApplyTransition(
    current,
    action,
    now,
    typeof body.reason === 'string' ? body.reason : undefined,
  );
  if (!transition.ok || !transition.patch) {
    return NextResponse.json({ error: transition.error || 'invalid transition' }, { status: 409 });
  }

  const { data: updated, error: updateError } = await supabaseAdmin()
    .from('applications')
    .update({ ...transition.patch, updated_at: now })
    .eq('id', params.id)
    .select('job_id, ai_apply_status, parked, applied_at')
    .maybeSingle();
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });
  if (!updated) return NextResponse.json({ error: 'not found' }, { status: 404 });

  if (action === 'submitted' && updated.job_id) {
    const { error: jobError } = await supabaseAdmin()
      .from('jobs')
      .update({ applied_at: updated.applied_at })
      .eq('id', updated.job_id);
    if (jobError) return NextResponse.json({ error: jobError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, application: updated });
}
