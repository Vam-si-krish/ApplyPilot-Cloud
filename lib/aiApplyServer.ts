import type { SupabaseClient } from '@supabase/supabase-js';
import { aiApplyReadiness, resolveAiApplyTransition, type AiApplyAction, AI_APPLY_STATUSES } from './aiApply';
import type { AiApplyStatus, ApplicationWithJob } from './types';

export interface AiApplyMutationResult {
  ok: boolean;
  status: number;
  error?: string;
  application?: Record<string, unknown>;
}

/** Shared user-scoped lifecycle mutation for the web UI and MCP agent surface. */
export async function mutateAiApplication(
  db: SupabaseClient,
  id: string,
  action: AiApplyAction,
  reason?: string,
): Promise<AiApplyMutationResult> {
  const { data, error } = await db
    .from('applications')
    .select(
      'id, job_id, status, applied_at, pdf_path, has_resume, ai_apply_status, ai_assigned_at, ai_apply_updated_at, ai_block_reason, parked, ' +
        'job:jobs(id, title, company, url, application_url, easy_apply)',
    )
    .eq('id', id)
    .maybeSingle();
  if (error) return { ok: false, status: 500, error: error.message };
  if (!data) return { ok: false, status: 404, error: 'not found' };

  const application = data as unknown as ApplicationWithJob;
  const current = typeof application.ai_apply_status === 'string'
    && AI_APPLY_STATUSES.includes(application.ai_apply_status as AiApplyStatus)
    ? application.ai_apply_status as AiApplyStatus
    : null;

  if (action === 'assign' || action === 'retry') {
    const readiness = aiApplyReadiness(application);
    if (!readiness.eligible) return { ok: false, status: 409, error: readiness.reason };
  }

  const now = new Date().toISOString();
  const transition = resolveAiApplyTransition(current, action, now, reason);
  if (!transition.ok || !transition.patch) {
    return { ok: false, status: 409, error: transition.error || 'invalid transition' };
  }

  const { data: updated, error: updateError } = await db
    .from('applications')
    .update({ ...transition.patch, updated_at: now })
    .eq('id', id)
    .select('job_id, ai_apply_status, parked, applied_at')
    .maybeSingle();
  if (updateError) return { ok: false, status: 500, error: updateError.message };
  if (!updated) return { ok: false, status: 404, error: 'not found' };

  if (action === 'submitted' && updated.job_id) {
    const { error: jobError } = await db.from('jobs').update({ applied_at: updated.applied_at }).eq('id', updated.job_id);
    if (jobError) return { ok: false, status: 500, error: jobError.message };
  }

  return { ok: true, status: 200, application: updated as Record<string, unknown> };
}
