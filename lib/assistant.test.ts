import { describe, expect, it } from 'vitest';
import { buildAssistantSystem } from './assistant';
import type { Profile } from './types';

describe('buildAssistantSystem prompt caching (ADR 0069)', () => {
  it('marks the stable profile system block cacheable', () => {
    const message = buildAssistantSystem({
      assistant_profile: { availability: 'two weeks' },
      personal: { name: 'Taylor' },
      experience: {},
      compensation: {},
      work_authorization: {},
      skills_boundary: {},
      base_resume: null,
      resume_text: 'Backend engineer',
    } as unknown as Profile);

    expect(message.role).toBe('system');
    expect(Array.isArray(message.content)).toBe(true);
    const [part] = message.content as { text: string; cache?: boolean }[];
    expect(part.cache).toBe(true);
    expect(part.text).toContain('Taylor');
    expect(part.text).toContain('Backend engineer');
  });

  it('replaces stale onboarding résumé snapshots with the edited base résumé', () => {
    const message = buildAssistantSystem({
      assistant_profile: {
        resume_facts: { basics: { name: 'Old Name' } },
        work_history: [{ name: 'Old Employer' }],
        skills: ['Old Skill'],
      },
      personal: {}, experience: {}, compensation: {}, work_authorization: {}, skills_boundary: {},
      base_resume: {
        basics: { name: 'Current Name', summary: 'Current summary' },
        work: [{ name: 'Current Employer', highlights: [] }],
        education: [], skills: [{ name: 'Core', keywords: ['Current Skill'] }], projects: [],
      },
      resume_text: 'stale text',
    } as unknown as Profile);
    const [part] = message.content as { text: string }[];
    expect(part.text).toContain('Current Employer');
    expect(part.text).toContain('Current Skill');
    expect(part.text).not.toContain('Old Employer');
    expect(part.text).not.toContain('Old Skill');
  });
});
