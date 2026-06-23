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
});
