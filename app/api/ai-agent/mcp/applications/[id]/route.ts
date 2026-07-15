/** Read one grounded application context or advance its MCP-owned lifecycle. */
import { NextResponse } from 'next/server';
import { authenticateAiAgentRequest } from '@/lib/aiAgentAuth';
import { type AiApplyAction } from '@/lib/aiApply';
import { mutateAiApplication } from '@/lib/aiApplyServer';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MCP_ACTIONS: AiApplyAction[] = ['start', 'block', 'submitted'];

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const identity = await authenticateAiAgentRequest(req);
  if (!identity) return NextResponse.json({ error: 'invalid, expired, or revoked AI run token' }, { status: 401 });
  const db = supabaseAdmin(identity.userId);

  const [{ data: application, error: applicationError }, { data: profile, error: profileError }] = await Promise.all([
    db.from('applications').select(
      'id, status, applied_at, tailored_resume, cover_letter, pdf_path, cover_letter_pdf_path, has_resume, has_cover_letter, ' +
        'ai_apply_status, ai_assigned_at, ai_apply_updated_at, ai_block_reason, ' +
        'job:jobs(id, title, company, location, url, application_url, easy_apply, full_description)',
    ).eq('id', params.id).maybeSingle(),
    db.from('profile').select(
      'personal, experience, compensation, work_authorization, skills_boundary, candidate_preferences, assistant_profile, base_resume',
    ).eq('id', 1).maybeSingle(),
  ]);
  if (applicationError) return NextResponse.json({ error: applicationError.message }, { status: 500 });
  if (profileError) return NextResponse.json({ error: profileError.message }, { status: 500 });
  if (!application) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const applicationRow = application as unknown as Record<string, unknown> & { ai_apply_status: string | null };
  if (!['assigned', 'in_progress', 'ready_to_submit'].includes(applicationRow.ai_apply_status || '')) {
    return NextResponse.json({ error: 'application is not active in the AI queue' }, { status: 409 });
  }

  const preferences = (profile?.candidate_preferences && typeof profile.candidate_preferences === 'object')
    ? profile.candidate_preferences as Record<string, unknown>
    : {};
  return NextResponse.json({
    application: applicationRow,
    candidate: profile ? {
      personal: profile.personal,
      experience: profile.experience,
      compensation: profile.compensation,
      workAuthorization: profile.work_authorization,
      skillsBoundary: profile.skills_boundary,
      applicationAnswers: preferences.application_answers ?? {},
      assistantProfile: profile.assistant_profile,
      baseResume: profile.base_resume,
    } : null,
  });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const identity = await authenticateAiAgentRequest(req);
  if (!identity) return NextResponse.json({ error: 'invalid, expired, or revoked AI run token' }, { status: 401 });
  let body: { action?: unknown; reason?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  if (typeof body.action !== 'string' || !MCP_ACTIONS.includes(body.action as AiApplyAction)) {
    return NextResponse.json({ error: 'MCP action must be start, block, or submitted' }, { status: 400 });
  }
  const result = await mutateAiApplication(
    supabaseAdmin(identity.userId), params.id, body.action as AiApplyAction,
    typeof body.reason === 'string' ? body.reason : undefined,
  );
  return NextResponse.json(result.ok ? { ok: true, application: result.application } : { error: result.error }, { status: result.status });
}
