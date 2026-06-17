import { describe, it, expect } from 'vitest';
import { parseScoreResponse, buildScoreMessages, SCORE_PROMPT } from './scoring';

describe('parseScoreResponse', () => {
  it('parses a well-formed response into all four fields', () => {
    const r = parseScoreResponse(
      [
        'SCORE: 8',
        'KEYWORDS: React, TypeScript, Node.js',
        'NOTE: Strong frontend fit with minor backend gaps.',
        'REASONING: The candidate has 5 years of React work matching the core stack.',
      ].join('\n'),
    );
    expect(r).toEqual({
      score: 8,
      keywords: 'React, TypeScript, Node.js',
      note: 'Strong frontend fit with minor backend gaps.',
      reasoning: 'The candidate has 5 years of React work matching the core stack.',
    });
  });

  it('clamps scores above 10 down to 10', () => {
    expect(parseScoreResponse('SCORE: 12').score).toBe(10);
  });

  it('treats a malformed/absent SCORE as 0', () => {
    expect(parseScoreResponse('KEYWORDS: x').score).toBe(0);
    expect(parseScoreResponse('SCORE: none').score).toBe(0);
  });

  it('keeps 0 (invalid content) as 0', () => {
    expect(parseScoreResponse('SCORE: 0\nNOTE: not a job posting').score).toBe(0);
  });

  it('extracts the first integer from a noisy SCORE line', () => {
    expect(parseScoreResponse('SCORE: 7/10').score).toBe(7);
  });

  it('tolerates leading/trailing whitespace on lines', () => {
    const r = parseScoreResponse('   SCORE: 5   \n   NOTE:  hello  ');
    expect(r.score).toBe(5);
    expect(r.note).toBe('hello');
  });

  it('defaults reasoning to the full response when no REASONING line present', () => {
    const raw = 'SCORE: 4\nsome freeform text';
    expect(parseScoreResponse(raw).reasoning).toBe(raw);
  });
});

describe('buildScoreMessages', () => {
  it('uses SCORE_PROMPT as the system message', () => {
    const msgs = buildScoreMessages('my resume', { title: 'Eng', company: 'Acme', full_description: 'desc' });
    expect(msgs[0]).toEqual({ role: 'system', content: SCORE_PROMPT });
  });

  it('embeds resume and job, truncating description to 6000 chars', () => {
    const longDesc = 'x'.repeat(7000);
    const msgs = buildScoreMessages('RES', { title: 'T', company: 'C', location: 'NYC', full_description: longDesc });
    const user = msgs[1].content;
    expect(user.startsWith('RESUME:\nRES\n\n---\n\nJOB POSTING:\n')).toBe(true);
    expect(user).toContain('TITLE: T');
    expect(user).toContain('COMPANY: C');
    expect(user).toContain('LOCATION: NYC');
    expect(user).toContain('x'.repeat(6000));
    expect(user).not.toContain('x'.repeat(6001));
  });

  it('falls back to description when full_description is missing and defaults location to N/A', () => {
    const msgs = buildScoreMessages('R', { title: 'T', company: 'C', description: 'fallback' });
    expect(msgs[1].content).toContain('LOCATION: N/A');
    expect(msgs[1].content).toContain('DESCRIPTION:\nfallback');
  });
});
