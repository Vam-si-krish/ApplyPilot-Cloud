import { describe, it, expect } from 'vitest';
import { emptyResume, normalizeResume, extractJsonObject } from './resume';
import { buildResumeParseMessages, RESUME_PARSE_PROMPT } from './resumeParse';

describe('emptyResume', () => {
  it('is a well-formed, empty ResumeDoc', () => {
    expect(emptyResume()).toEqual({ basics: {}, work: [], education: [], skills: [], projects: [] });
  });
});

describe('normalizeResume — defensive coercion of arbitrary JSON', () => {
  it('flattens a nested JSON Resume location object to "City, Region"', () => {
    const out = normalizeResume({ basics: { name: 'V', location: { city: 'Boston', region: 'MA', countryCode: 'US' } } });
    expect(out.basics.location).toBe('Boston, MA');
  });

  it('accepts a string location as-is', () => {
    expect(normalizeResume({ basics: { location: 'Remote' } }).basics.location).toBe('Remote');
  });

  it('maps common aliases (company→name, title→position, summary→highlights)', () => {
    const out = normalizeResume({ work: [{ company: 'Acme', title: 'Engineer', summary: 'Did things' }] });
    expect(out.work[0].name).toBe('Acme');
    expect(out.work[0].position).toBe('Engineer');
    expect(out.work[0].highlights).toEqual(['Did things']);
  });

  it('drops non-string highlights and blank entries', () => {
    const out = normalizeResume({ work: [{ name: 'X', highlights: ['real', 2, null, '  ', 'also real'] }] });
    expect(out.work[0].highlights).toEqual(['real', 'also real']);
  });

  it('splits a string skill list and tolerates bare-string skills', () => {
    const out = normalizeResume({ skills: [{ name: 'Frontend', keywords: 'React, TypeScript' }, 'Node.js'] });
    expect(out.skills[0]).toEqual({ name: 'Frontend', keywords: ['React', 'TypeScript'] });
    expect(out.skills[1]).toEqual({ name: 'Node.js', keywords: [] });
  });

  it('parses education aliases (school→institution, degree→studyType, gpa→score)', () => {
    const out = normalizeResume({ education: [{ school: 'Hult', degree: 'MS', area: 'Business Analytics', gpa: '3.9' }] });
    expect(out.education[0]).toMatchObject({ institution: 'Hult', studyType: 'MS', area: 'Business Analytics', score: '3.9' });
  });

  it('returns the empty shape for junk input — never throws', () => {
    expect(normalizeResume(null)).toEqual(emptyResume());
    expect(normalizeResume('not an object')).toEqual(emptyResume());
    expect(normalizeResume(42)).toEqual(emptyResume());
  });

  it('keeps profiles with a network or url, drops empty ones', () => {
    const out = normalizeResume({ basics: { profiles: [{ network: 'LinkedIn', url: 'x' }, {}, { username: 'gh' }] } });
    expect(out.basics.profiles).toEqual([{ network: 'LinkedIn', url: 'x' }, { network: undefined, url: 'gh' }]);
  });
});

describe('extractJsonObject — pull JSON out of an LLM response', () => {
  it('parses a bare JSON object', () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 });
  });

  it('strips ```json fences and surrounding prose', () => {
    const text = 'Here you go:\n```json\n{"basics":{"name":"V"}}\n```\nDone.';
    expect(extractJsonObject(text)).toEqual({ basics: { name: 'V' } });
  });

  it('handles braces inside strings via a balanced scan', () => {
    expect(extractJsonObject('prefix {"s":"a {nested} brace"} suffix')).toEqual({ s: 'a {nested} brace' });
  });

  it('returns null when nothing parses', () => {
    expect(extractJsonObject('no json here')).toBeNull();
    expect(extractJsonObject('')).toBeNull();
  });
});

describe('buildResumeParseMessages', () => {
  it('uses the parse prompt and truncates very long résumé text to 15000 chars', () => {
    const msgs = buildResumeParseMessages('x'.repeat(20000));
    expect(msgs[0]).toEqual({ role: 'system', content: RESUME_PARSE_PROMPT });
    expect(msgs[1].content.length).toBeLessThanOrEqual(15000 + 'RÉSUMÉ TEXT:\n'.length);
  });
});
