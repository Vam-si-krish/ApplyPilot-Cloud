import { describe, expect, it } from 'vitest';
import { composeScoringCandidateContext, composeScoringResume, selectCalendarConfirmationMatch } from './db';
import { normalizeResume } from './resume';
import type { MailMessage } from './types';

describe('composeScoringResume', () => {
  it('adds only the current user\'s explicit work-authorization facts to the résumé dossier', () => {
    const base = normalizeResume({ basics: { name: 'Jordan Candidate' }, work: [], education: [], skills: [], projects: [] });
    const dossier = composeScoringCandidateContext(base, 'Jordan Candidate', {
      legally_authorized_to_work: true,
      require_sponsorship: false,
      citizenship_or_residency: 'US citizen',
    }, { avoid_security_clearance_jobs: true, scoring_instructions: 'Prefer product roles' });

    expect(dossier).toContain('Jordan Candidate');
    expect(dossier).toContain('USER-MAINTAINED PROFILE FACTS');
    expect(dossier).toContain('"require_sponsorship":false');
    expect(dossier).toContain('"citizenship_or_residency":"US citizen"');
    expect(dossier).toContain('"avoid_security_clearance_jobs":true');
    expect(dossier).toContain('Prefer product roles');
    expect(dossier).not.toMatch(/F1 OPT|H-1B/i);
  });

  it('labels missing authorization facts as an empty object rather than inventing defaults', () => {
    expect(composeScoringCandidateContext(null, 'Résumé text')).toContain('"work_authorization":{}');
    expect(composeScoringResume(null, 'Résumé text')).not.toContain('work_authorization');
  });
});

describe('selectCalendarConfirmationMatch', () => {
  const event = (id: string, thread: string, subject: string, from = 'talent@walmart.com') => ({
    id, thread_id: thread, subject, summary: subject, from_email: from,
  } as MailMessage);

  it('prefers an exact Gmail thread and rejects ambiguous fuzzy matches', () => {
    const events = [
      event('one', 'thread-1', 'Walmart Full Stack Engineering Assessment'),
      event('two', 'thread-2', 'Walmart Frontend Engineering Assessment'),
    ];
    expect(selectCalendarConfirmationMatch(events, {
      thread_id: 'thread-1', from_email: 'talent@walmart.com',
      subject: 'Your assessment was submitted', summary: 'Submission received',
    })?.id).toBe('one');
    expect(selectCalendarConfirmationMatch(events, {
      thread_id: 'different', from_email: 'talent@walmart.com',
      subject: 'Your engineering assessment was submitted', summary: 'Submission received',
    })).toBeNull();
  });

  it('accepts a unique strong sender and subject match', () => {
    const events = [event('one', 'thread-1', 'Walmart Full Stack Engineering Assessment')];
    expect(selectCalendarConfirmationMatch(events, {
      thread_id: 'different', from_email: 'notifications@walmart.com',
      subject: 'Walmart Full Stack Engineering submission received', summary: 'Walmart confirms Full Stack submission',
    })?.id).toBe('one');
  });
});
