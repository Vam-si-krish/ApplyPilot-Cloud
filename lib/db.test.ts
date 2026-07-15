import { describe, expect, it } from 'vitest';
import { composeScoringCandidateContext, composeScoringResume } from './db';
import { normalizeResume } from './resume';

describe('composeScoringResume', () => {
  it('adds only the current user\'s explicit work-authorization facts to the résumé dossier', () => {
    const base = normalizeResume({ basics: { name: 'Jordan Candidate' }, work: [], education: [], skills: [], projects: [] });
    const dossier = composeScoringCandidateContext(base, 'Jordan Candidate', {
      legally_authorized_to_work: true,
      require_sponsorship: false,
      citizenship_or_residency: 'US citizen',
    });

    expect(dossier).toContain('Jordan Candidate');
    expect(dossier).toContain('USER-MAINTAINED PROFILE FACTS');
    expect(dossier).toContain('"require_sponsorship":false');
    expect(dossier).toContain('"citizenship_or_residency":"US citizen"');
    expect(dossier).not.toMatch(/F1 OPT|H-1B/i);
  });

  it('labels missing authorization facts as an empty object rather than inventing defaults', () => {
    expect(composeScoringCandidateContext(null, 'Résumé text')).toContain('"work_authorization":{}');
    expect(composeScoringResume(null, 'Résumé text')).not.toContain('work_authorization');
  });
});
