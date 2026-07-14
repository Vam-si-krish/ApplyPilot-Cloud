import { describe, expect, it } from 'vitest';
import { deriveOnboarding } from './onboarding';
import { normalizeResume } from './resume';

describe('deriveOnboarding', () => {
  it('builds profile and search defaults only from parsed résumé facts', () => {
    const setup = deriveOnboarding(normalizeResume({
      basics: {
        name: 'Ada Candidate', label: 'Platform Engineer', email: 'ada@example.com',
        location: 'New York, NY', profiles: [{ network: 'LinkedIn', url: 'https://linkedin.example/ada' }],
      },
      work: [{ name: 'Example Co', position: 'Software Engineer', startDate: '2021', endDate: 'Present', highlights: ['Built APIs'] }],
      education: [{ institution: 'Example U', studyType: 'BS', area: 'Computer Science' }],
      skills: [
        { name: 'Programming Languages', keywords: ['TypeScript', 'Python'] },
        { name: 'Frameworks', keywords: ['React', 'FastAPI'] },
        { name: 'Tools', keywords: ['Docker'] },
      ],
    }));
    expect(setup.personal.full_name).toBe('Ada Candidate');
    expect(setup.settings.keywords).toEqual(['Platform Engineer', 'Software Engineer']);
    expect(setup.settings.locations).toEqual(['New York, NY']);
    expect(setup.settings.skills).toContain('TypeScript');
    expect(setup.skillsBoundary.programming_languages).toEqual(['TypeScript', 'Python']);
    expect(setup.resumeText).toContain('Built APIs');
  });
});
