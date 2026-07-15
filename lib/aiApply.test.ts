import { describe, expect, it } from 'vitest';
import {
  aiApplyReadiness,
  buildAiNavigationPrompt,
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

describe('AI navigation with extension-owned autofill', () => {
  it('accepts every unapplied linked job regardless of apply type or document readiness', () => {
    expect(aiApplyReadiness(application())).toMatchObject({ eligible: true });
    expect(aiApplyReadiness(application({ job: { ...application().job!, easy_apply: true } }))).toMatchObject({ eligible: true });
    expect(
      aiApplyReadiness(
        application({ job: { ...application().job!, application_url: 'https://www.linkedin.com/jobs/view/1' } }),
      ),
    ).toMatchObject({ eligible: true });
    expect(aiApplyReadiness(application({ status: 'queued', has_resume: false, pdf_path: null }))).toMatchObject({ eligible: true });
    expect(
      aiApplyReadiness(application({ job: { ...application().job!, application_url: null, url: '' } })).reason,
    ).toContain('valid application link');
    expect(aiApplyReadiness(application({ status: 'applied', applied_at: '2026-07-15T01:00:00.000Z' })).reason).toContain('already');
  });

  it('records direct visible-success submission and blockers without changing tailoring readiness', () => {
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
    expect(resolveAiApplyTransition('in_progress', 'submitted', now)).toMatchObject({
      ok: true,
      patch: { ai_apply_status: 'submitted', status: 'applied', applied_at: now },
    });
    // Backward compatibility for rows that reached the old review state before ADR 0094.
    expect(resolveAiApplyTransition('ready_to_submit', 'submitted', now)).toMatchObject({ ok: true });
    expect(isActiveAiApplyStatus('submitted')).toBe(false);
  });

  it('builds a bounded extension-autofill prompt that submits and skips unassigned rows', () => {
    const assigned = application({ ai_apply_status: 'assigned' });
    const prompt = buildAiNavigationPrompt([
      assigned,
      application({ id: 'unassigned', ai_apply_status: null }),
      ...Array.from({ length: 25 }, (_, index) =>
        application({ id: `extra-${index}`, ai_apply_status: 'assigned' }),
      ),
    ]);

    expect(prompt).toContain('Software Engineer — Example (ApplyPilot ID application-1)');
    expect(prompt).not.toContain('unassigned');
    expect(prompt).toContain('extra-18');
    expect(prompt).not.toContain('extra-19');
    expect(prompt).toContain('Process at most 20 applications');
    expect(prompt).toContain('fill only those fields from information already available');
    expect(prompt).toContain('mark the job Needs review');
    expect(prompt).toContain('continue with the next job in a new tab');
    expect(prompt).toContain('Never invent an answer');
  });
});
