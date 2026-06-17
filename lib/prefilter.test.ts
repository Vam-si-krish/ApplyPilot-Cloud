import { describe, it, expect } from 'vitest';
import { tokenize, computeIdf, coverageScore, prefilterScores } from './prefilter';

describe('tokenize', () => {
  it('lowercases, drops stopwords, and keeps tech tokens', () => {
    const toks = tokenize('Senior C++ and React.js engineer with the Node.js stack');
    expect(toks).toContain('c++');
    expect(toks).toContain('react.js');
    expect(toks).toContain('node.js');
    expect(toks).toContain('engineer');
    // stopwords removed
    expect(toks).not.toContain('and');
    expect(toks).not.toContain('the');
    expect(toks).not.toContain('with');
  });

  it('drops sub-2-char tokens and trims trailing dots', () => {
    expect(tokenize('a in node.')).toEqual(['node']);
  });

  it('returns [] for empty/blank input', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize('   ')).toEqual([]);
  });
});

describe('computeIdf', () => {
  it('gives a term in every document zero weight, and rarer terms more', () => {
    const idf = computeIdf([
      ['react', 'common'],
      ['python', 'common'],
    ]);
    expect(idf.get('common')).toBe(0); // df=2, N=2 -> ln(1)=0
    expect(idf.get('react')!).toBeGreaterThan(0);
  });
});

describe('coverageScore', () => {
  const idf = computeIdf([
    ['react', 'typescript', 'node'],
    ['react', 'typescript', 'aws'],
    ['nursing', 'patient', 'care'],
  ]);

  it('is higher when the résumé covers the job\'s weighted terms', () => {
    const resume = new Set(['react', 'typescript', 'node', 'aws']);
    const swe = coverageScore(resume, ['react', 'typescript', 'aws'], idf);
    const nurse = coverageScore(resume, ['nursing', 'patient', 'care'], idf);
    expect(swe).toBeGreaterThan(nurse);
    expect(nurse).toBe(0); // none of the nursing terms are in the résumé
  });

  it('returns 0 when the job has no weighted vocabulary', () => {
    expect(coverageScore(new Set(['react']), [], idf)).toBe(0);
  });
});

describe('prefilterScores', () => {
  it('scores a matching job above an unrelated one and clamps to 0–100', () => {
    const resume = 'Software engineer skilled in React, TypeScript, Node.js and AWS cloud infrastructure.';
    const scores = prefilterScores(resume, [
      { id: 'swe', text: 'We need a React and TypeScript engineer to build Node.js services on AWS.' },
      { id: 'nurse', text: 'Registered nurse providing bedside patient care in the ICU ward.' },
    ]);
    const swe = scores.get('swe')!;
    const nurse = scores.get('nurse')!;
    expect(swe).toBeGreaterThan(nurse);
    expect(swe).toBeGreaterThanOrEqual(0);
    expect(swe).toBeLessThanOrEqual(100);
  });

  it('returns an empty map when the résumé is empty (caller treats null as pass)', () => {
    expect(prefilterScores('', [{ id: 'x', text: 'anything' }]).size).toBe(0);
  });
});
