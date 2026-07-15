/** Bearer-authenticated, user-scoped queue projection for the ApplyPilot MCP plugin. */
import { NextResponse } from 'next/server';
import { authenticateAiAgentRequest } from '@/lib/aiAgentAuth';
import { aiApplyReadiness, isActiveAiApplyStatus } from '@/lib/aiApply';
import { supabaseAdmin } from '@/lib/supabase';
import type { ApplicationWithJob } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const identity = await authenticateAiAgentRequest(req);
  if (!identity) return NextResponse.json({ error: 'invalid, expired, or revoked AI run token' }, { status: 401 });
  const requested = Number(new URL(req.url).searchParams.get('limit') || 20);
  const limit = Number.isFinite(requested) ? Math.max(1, Math.min(Math.floor(requested), 50)) : 20;

  const { data, error } = await supabaseAdmin(identity.userId)
    .from('applications')
    .select(
      'id, job_id, status, applied_at, pdf_path, cover_letter_pdf_path, has_resume, has_cover_letter, ' +
        'ai_apply_status, ai_assigned_at, ai_apply_updated_at, ai_block_reason, parked, ' +
        'job:jobs(id, title, company, location, url, application_url, easy_apply)',
    )
    .in('ai_apply_status', ['assigned', 'in_progress', 'ready_to_submit'])
    .order('ai_assigned_at', { ascending: true })
    .limit(limit);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const applications = ((data ?? []) as unknown as ApplicationWithJob[])
    .filter((application) => isActiveAiApplyStatus(application.ai_apply_status))
    .map((application) => {
      const readiness = aiApplyReadiness(application);
      return {
        id: application.id,
        status: application.ai_apply_status,
        assignedAt: application.ai_assigned_at,
        targetUrl: readiness.targetUrl,
        documents: {
          tailoredResumeReady: Boolean(application.has_resume || application.pdf_path),
          coverLetterReady: Boolean(application.has_cover_letter || application.cover_letter_pdf_path),
        },
        job: application.job ? {
          title: application.job.title,
          company: application.job.company,
          location: application.job.location,
          easyApply: application.job.easy_apply,
        } : null,
      };
    });

  return NextResponse.json({ applications, count: applications.length, expiresAt: new Date(identity.expiresAt).toISOString() });
}
