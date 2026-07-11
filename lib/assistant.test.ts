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
});
