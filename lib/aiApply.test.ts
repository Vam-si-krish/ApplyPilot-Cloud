import { describe, expect, it } from 'vitest';
import {
  aiApplyReadiness,
  buildSupervisedApplyPrompt,
  isActiveAiApplyStatus,
  resolveAiApplyTransition,
} from './aiApply';
import type { ApplicationWithJob } from './types';

function application(overrides: Partial<ApplicationWithJob> = {}): ApplicationWithJob {
  return {
    id: 'application-1',
    job_id: 'job-1',
    status: 'ready',
    template: 'classic',
    has_resume: true,
    tailor_changes: null,
    tailor_instructions: null,
    tailored_fit_score: null,
    tailored_score_note: null,
    tailored_match_score: null,
    tailored_match_breakdown: null,
    base_match_score: null,
    pdf_path: 'user/application/resume.pdf',
    cover_letter_pdf_path: null,
    cover_letter_error: null,
    error: null,
    parked: false,
    ai_apply_status: null,
    ai_assigned_at: null,
    ai_apply_updated_at: null,
    ai_block_reason: null,
    tailor_usage: null,
    created_at: '2026-07-15T00:00:00.000Z',
    updated_at: '2026-07-15T00:00:00.000Z',
    applied_at: null,
    job: {
      id: 'job-1',
      title: 'Software Engineer',
      company: 'Example',
      url: 'https://jobs.example.com/role',
      application_url: 'https://jobs.example.com/apply',
      easy_apply: false,
    } as ApplicationWithJob['job'],
    ...overrides,
  };
}

describe('supervised AI application assignment', () => {
  it('accepts only ready external applications with a tailored PDF', () => {
    expect(aiApplyReadiness(application())).toMatchObject({ eligible: true });
    expect(
      aiApplyReadiness(
        application({ job: { ...application().job!, easy_apply: true } }),
      ).reason,
    ).toContain('external');
    expect(
      aiApplyReadiness(
        application({ job: { ...application().job!, application_url: 'https://www.linkedin.com/jobs/view/1' } }),
      ).reason,
    ).toContain('LinkedIn');
    expect(aiApplyReadiness(application({ pdf_path: null })).reason).toContain('PDF');
    expect(aiApplyReadiness(application({ status: 'applied', applied_at: '2026-07-15T01:00:00.000Z' })).reason).toContain('already');
  });

  it('enforces the reviewed lifecycle and records blockers without changing tailoring readiness', () => {
    const now = '2026-07-15T01:00:00.000Z';
    expect(resolveAiApplyTransition(null, 'assign', now)).toMatchObject({
      ok: true,
      patch: { ai_apply_status: 'assigned', parked: false },
    });
    expect(resolveAiApplyTransition('assigned', 'ready', now)).toMatchObject({ ok: false });
    expect(resolveAiApplyTransition('assigned', 'start', now)).toMatchObject({
      ok: true,
      patch: { ai_apply_status: 'in_progress' },
    });
    expect(resolveAiApplyTransition('in_progress', 'block', now, ' CAPTCHA\nrequired ')).toMatchObject({
      ok: true,
      patch: { ai_apply_status: 'blocked', ai_block_reason: 'CAPTCHA required', parked: true },
    });
    expect(resolveAiApplyTransition('blocked', 'retry', now)).toMatchObject({
      ok: true,
      patch: { ai_apply_status: 'assigned', ai_block_reason: null, parked: false },
    });
    expect(resolveAiApplyTransition('in_progress', 'ready', now)).toMatchObject({
      ok: true,
      patch: { ai_apply_status: 'ready_to_submit' },
    });
    expect(resolveAiApplyTransition('ready_to_submit', 'submitted', now)).toMatchObject({
      ok: true,
      patch: { ai_apply_status: 'submitted', status: 'applied', applied_at: now },
    });
    expect(isActiveAiApplyStatus('submitted')).toBe(false);
  });

  it('builds a bounded prompt that pauses before submission and skips unassigned rows', () => {
    const assigned = application({ ai_apply_status: 'assigned' });
    const prompt = buildSupervisedApplyPrompt([
      assigned,
      application({ id: 'unassigned', ai_apply_status: null }),
      ...Array.from({ length: 8 }, (_, index) =>
        application({ id: `extra-${index}`, ai_apply_status: 'assigned' }),
      ),
    ]);

    expect(prompt).toContain('Software Engineer — Example (ApplyPilot ID application-1)');
    expect(prompt).not.toContain('unassigned');
    expect(prompt).not.toContain('extra-4');
    expect(prompt).toContain('Ask for confirmation immediately before Submit');
    expect(prompt).toContain('Do not automate LinkedIn');
  });
});
