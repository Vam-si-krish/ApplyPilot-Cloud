import { describe, it, expect } from 'vitest';
import { parseMailResponse } from './mailClassify';

describe('parseMailResponse', () => {
  it('parses category, apply source, and summary', () => {
    const r = parseMailResponse('CATEGORY: applied\nSOURCE: easy_apply\nSUMMARY: Application sent to Acme.');
    expect(r.category).toBe('applied');
    expect(r.apply_source).toBe('easy_apply');
    expect(r.summary).toBe('Application sent to Acme.');
  });

  it('recognizes company_portal', () => {
    expect(parseMailResponse('CATEGORY: applied\nSOURCE: company_portal\nSUMMARY: x').apply_source).toBe('company_portal');
  });

  it('recognizes the recruiter category (inbound outreach, no application)', () => {
    const r = parseMailResponse('CATEGORY: recruiter\nSOURCE: none\nSUMMARY: Recruiter at Randstad reaching out about a Sr Front End role.');
    expect(r.category).toBe('recruiter');
    expect(r.apply_source).toBeNull();
  });

  it('leaves apply_source null for SOURCE: none or when absent', () => {
    expect(parseMailResponse('CATEGORY: other\nSOURCE: none\nSUMMARY: newsletter').apply_source).toBeNull();
    expect(parseMailResponse('CATEGORY: rejection\nSUMMARY: no').apply_source).toBeNull();
  });

  it('defaults category to other and ignores junk SOURCE values', () => {
    const r = parseMailResponse('CATEGORY: nonsense\nSOURCE: whatever\nSUMMARY: ?');
    expect(r.category).toBe('other');
    expect(r.apply_source).toBeNull();
  });

  it('keeps grounded assessment dates and normalizes them to UTC', () => {
    const r = parseMailResponse([
      'CATEGORY: assessment',
      'SOURCE: none',
      'SUMMARY: Complete the coding assessment.',
      'ASSESSMENT_START: 2026-07-20T09:00:00-04:00',
      'ASSESSMENT_END: 2026-07-22T17:00:00-04:00',
    ].join('\n'));
    expect(r.assessment_start_at).toBe('2026-07-20T13:00:00.000Z');
    expect(r.assessment_end_at).toBe('2026-07-22T21:00:00.000Z');
  });

  it('drops assessment dates for other mail and rejects invented or reversed dates', () => {
    expect(parseMailResponse('CATEGORY: other\nASSESSMENT_END: 2026-07-22T17:00:00Z').assessment_end_at).toBeNull();
    const reversed = parseMailResponse('CATEGORY: assessment\nASSESSMENT_START: 2026-07-23T17:00:00Z\nASSESSMENT_END: 2026-07-22T17:00:00Z');
    expect(reversed.assessment_start_at).toBeNull();
    expect(reversed.assessment_end_at).toBeNull();
  });
});
