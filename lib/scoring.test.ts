import { describe, it, expect } from 'vitest';
import { parseScoreResponse, buildScoreMessages, SCORE_PROMPT } from './scoring';

describe('parseScoreResponse', () => {
  it('parses a well-formed response into the core fields', () => {
    const r = parseScoreResponse(
      [
        'SCORE: 8',
        'KEYWORDS: React, TypeScript, Node.js',
        'NOTE: Strong frontend fit with minor backend gaps.',
        'REASONING: The candidate has 5 years of React work matching the core stack.',
      ].join('\n'),
    );
    expect(r.score).toBe(8);
    expect(r.keywords).toBe('React, TypeScript, Node.js');
    expect(r.note).toBe('Strong frontend fit with minor backend gaps.');
    expect(r.reasoning).toBe('The candidate has 5 years of React work matching the core stack.');
  });

  it('parses the v2 rubric fields (employment, seniority, breakdown, missing)', () => {
    const r = parseScoreResponse(
      [
        'SCORE: 7',
        'EMPLOYMENT: contract',
        'SENIORITY: strong_fit',
        'BREAKDOWN: skills=50 domain=20 experience=12',
        'KEYWORDS: React, Node',
        'MISSING: Kubernetes, GraphQL',
        'NOTE: Solid.',
        'REASONING: ok.',
      ].join('\n'),
    );
    expect(r.employment_type).toBe('contract');
    expect(r.seniority).toBe('strong_fit');
    expect(r.breakdown).toEqual({ skills: 50, domain: 20, experience: 12 });
    expect(r.missing).toBe('Kubernetes, GraphQL');
  });

  it('treats MISSING: none as no gaps and clamps over-range sub-scores', () => {
    const r = parseScoreResponse('SCORE: 9\nBREAKDOWN: skills=99 domain=0 experience=0\nMISSING: none');
    expect(r.missing).toBe('');
    expect(r.breakdown?.skills).toBe(60); // clamped to the dimension max (0–60)
  });

  it('leaves v2 fields null on an old-style response', () => {
    const r = parseScoreResponse('SCORE: 6\nKEYWORDS: x\nNOTE: y\nREASONING: z');
    expect(r.employment_type).toBeNull();
    expect(r.breakdown).toBeNull();
    expect(r.missing).toBeNull();
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

  it('embeds resume and job, truncating description to 15000 chars', () => {
    const longDesc = 'x'.repeat(16000);
    const msgs = buildScoreMessages('RES', { title: 'T', company: 'C', location: 'NYC', full_description: longDesc });
    const user = msgs[1].content as string; // scoring messages are always plain strings
    expect(user.startsWith('RESUME:\nRES\n\n---\n\nJOB POSTING:\n')).toBe(true);
    expect(user).toContain('TITLE: T');
    expect(user).toContain('COMPANY: C');
    expect(user).toContain('LOCATION: NYC');
    expect(user).toContain('x'.repeat(15000));
    expect(user).not.toContain('x'.repeat(15001));
  });

  it('falls back to description when full_description is missing and defaults location to N/A', () => {
    const msgs = buildScoreMessages('R', { title: 'T', company: 'C', description: 'fallback' });
    expect(msgs[1].content).toContain('LOCATION: N/A');
    expect(msgs[1].content).toContain('DESCRIPTION:\nfallback');
  });
});
