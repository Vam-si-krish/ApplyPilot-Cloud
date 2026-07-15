import { describe, expect, it, vi } from 'vitest';
import type { LLMClient } from './llm';
import { parseResumeSetup, RESUME_PARSE_PROMPT } from './resumeParse';

describe('parseResumeSetup', () => {
  it('keeps only explicitly returned, well-typed work-authorization facts', async () => {
    const client = {
      chat: vi.fn().mockResolvedValue(JSON.stringify({
        basics: { name: 'Jordan Candidate' }, work: [], education: [], skills: [], projects: [],
        profile_work_authorization: {
          legally_authorized_to_work: true,
          require_sponsorship: false,
          work_permit_type: 'US citizen',
          security_clearance: 123,
          unexpected: 'discard me',
        },
      })),
    } as unknown as LLMClient;

    const parsed = await parseResumeSetup('Jordan Candidate résumé with more than enough text.', client);
    expect(parsed.resume.basics.name).toBe('Jordan Candidate');
    expect(parsed.workAuthorization).toEqual({
      legally_authorized_to_work: true,
      require_sponsorship: false,
      work_permit_type: 'US citizen',
    });
    expect(RESUME_PARSE_PROMPT).toContain('include a field ONLY when the résumé explicitly states it');
  });

  it('leaves authorization unknown when the parser returns no explicit facts', async () => {
    const client = {
      chat: vi.fn().mockResolvedValue('{"basics":{"name":"Taylor"},"work":[],"education":[],"skills":[],"projects":[],"profile_work_authorization":{}}'),
    } as unknown as LLMClient;
    expect((await parseResumeSetup('Taylor résumé text', client)).workAuthorization).toEqual({});
  });
});
