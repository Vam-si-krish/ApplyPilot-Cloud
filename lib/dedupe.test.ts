import { describe, it, expect } from 'vitest';
import { jobContentKey } from './dedupe';

describe('jobContentKey (ADR 0057)', () => {
  it('is identical for the same posting re-blasted to different locations', () => {
    const desc = '<p>Build React apps.</p><ul><li>5+ years</li></ul>';
    const a = jobContentKey('Deloitte', 'Software Engineer II', desc);
    const b = jobContentKey('Deloitte', 'Software Engineer II', desc);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
  });

  it('ignores case, whitespace, and HTML variations (repost noise)', () => {
    const a = jobContentKey('Deloitte', 'Software Engineer II', '<p>Build  React apps.</p>');
    const b = jobContentKey('DELOITTE ', ' Software   Engineer II', 'Build React apps.');
    expect(a).toBe(b);
  });

  it('differs when the company, title, or body genuinely differ', () => {
    const base = jobContentKey('Deloitte', 'Software Engineer II', 'Build React apps.');
    expect(jobContentKey('Epic', 'Software Engineer II', 'Build React apps.')).not.toBe(base);
    expect(jobContentKey('Deloitte', 'Software Engineer III', 'Build React apps.')).not.toBe(base);
    expect(jobContentKey('Deloitte', 'Software Engineer II', 'Build Angular apps.')).not.toBe(base);
  });

  it('returns null for fully empty rows (never group unrelated blanks)', () => {
    expect(jobContentKey(null, '', undefined)).toBeNull();
    expect(jobContentKey('Acme', null, null)).not.toBeNull(); // partial data still keys
  });
});
