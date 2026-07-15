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

  it('parses the merged company-assessment fields (ADR 0065)', () => {
    const r = parseScoreResponse(
      [
        'SCORE: 8',
        'NOTE: Strong fit.',
        'COMPANY_TIER: low',
        'COMPANY_NOTE: Listing exists mainly to harvest résumés for a lead-gen service.',
        'TECH_STACK: React, TypeScript, React', // dupe should collapse
      ].join('\n'),
    );
    // COMPANY_NOTE must NOT be mistaken for the fit NOTE, and vice-versa.
    expect(r.note).toBe('Strong fit.');
    expect(r.company_tier).toBe('low');
    expect(r.company_tier_note).toBe('Listing exists mainly to harvest résumés for a lead-gen service.');
    expect(r.tech_stack).toEqual(['React', 'TypeScript']);
  });

  it('defaults an unrecognized COMPANY_TIER to unknown and "none" tech to null', () => {
    const r = parseScoreResponse('SCORE: 5\nCOMPANY_TIER: sketchy\nTECH_STACK: none');
    expect(r.company_tier).toBe('unknown');
    expect(r.tech_stack).toBeNull();
  });

  it('treats MISSING: none as no gaps and clamps over-range sub-scores', () => {
    const r = parseScoreResponse('SCORE: 9\nBREAKDOWN: skills=99 domain=0 experience=0\nMISSING: none');
    expect(r.missing).toBe('');
    expect(r.breakdown?.skills).toBe(60); // clamped to the dimension max (0–60)
  });

  it('leaves v2 + company fields null on an old-style response', () => {
    const r = parseScoreResponse('SCORE: 6\nKEYWORDS: x\nNOTE: y\nREASONING: z');
    expect(r.employment_type).toBeNull();
    expect(r.breakdown).toBeNull();
    expect(r.missing).toBeNull();
    expect(r.company_tier).toBeNull();
    expect(r.company_tier_note).toBeNull();
    expect(r.tech_stack).toBeNull();
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
  // ADR 0066: three messages — system(SCORE_PROMPT), system(résumé, cached), user(job).
  const resumeBlock = (msgs: ReturnType<typeof buildScoreMessages>) =>
    msgs[1].content as { text: string; cache?: boolean }[];
  const jobText = (msgs: ReturnType<typeof buildScoreMessages>) =>
    (msgs[2].content as { text: string }[]).map((p) => p.text).join('\n\n');

  it('uses SCORE_PROMPT as the first system message', () => {
    const msgs = buildScoreMessages('my resume', { title: 'Eng', company: 'Acme', full_description: 'desc' });
    expect(msgs[0]).toEqual({ role: 'system', content: SCORE_PROMPT });
  });

  it('puts the résumé in a cached SECOND system message; the job stays in the user tail (ADR 0066)', () => {
    const msgs = buildScoreMessages('RES', { title: 'T', company: 'C', full_description: 'desc' });
    expect(msgs).toHaveLength(3);
    expect(msgs[1].role).toBe('system');
    const rb = resumeBlock(msgs);
    expect(rb[0].cache).toBe(true); // the résumé is the cache breakpoint
    expect(rb[0].text).toContain('CANDIDATE CONTEXT:\nRES');
    expect(rb[0].text).not.toContain('JOB POSTING'); // per-job content must not poison the cached prefix
    expect(msgs[2].role).toBe('user');
    expect(jobText(msgs)).toContain('JOB POSTING:');
  });

  it('embeds the job fields, truncating description to 15000 chars', () => {
    const longDesc = 'x'.repeat(16000);
    const msgs = buildScoreMessages('RES', { title: 'T', company: 'C', company_size: '51-200 employees', location: 'NYC', full_description: longDesc });
    const job = jobText(msgs);
    expect(job.startsWith('JOB POSTING:\n')).toBe(true);
    expect(job).toContain('TITLE: T');
    expect(job).toContain('COMPANY: C');
    expect(job).toContain('COMPANY SIZE: 51-200 employees');
    expect(job).toContain('LOCATION: NYC');
    expect(job).toContain('x'.repeat(15000));
    expect(job).not.toContain('x'.repeat(15001));
    // résumé stays in the cached system block, not the job tail
    expect(resumeBlock(msgs)[0].text).toContain('CANDIDATE CONTEXT:\nRES');
  });

  it('strips HTML from the description before truncation (ADR 0056)', () => {
    const msgs = buildScoreMessages('R', {
      title: 'T',
      company: 'C',
      full_description: '<p>Build <strong>React</strong> apps</p><ul><li>5+ years</li></ul>',
    });
    const job = jobText(msgs);
    expect(job).toContain('Build');
    expect(job).toContain('React');
    expect(job).toContain('5+ years');
    expect(job).not.toContain('<p>');
    expect(job).not.toContain('<strong>');
  });

  it('falls back to description when full_description is missing and defaults location to N/A', () => {
    const msgs = buildScoreMessages('R', { title: 'T', company: 'C', description: 'fallback' });
    const job = jobText(msgs);
    expect(job).toContain('LOCATION: N/A');
    expect(job).toContain('DESCRIPTION:\nfallback');
  });

  it('keeps the rubric owner-neutral and requires candidate-specific eligibility facts', () => {
    expect(SCORE_PROMPT).not.toMatch(/candidate is on F1|they are, on OPT|will need H-1B/i);
    expect(SCORE_PROMPT).toContain('Never assume every candidate has the same immigration');
    expect(SCORE_PROMPT).toContain('missing/blank profile field means UNKNOWN');
    expect(SCORE_PROMPT).toContain('avoid_security_clearance_jobs=true');
    expect(SCORE_PROMPT).toContain('scoring_preferences.scoring_instructions');
  });
});
