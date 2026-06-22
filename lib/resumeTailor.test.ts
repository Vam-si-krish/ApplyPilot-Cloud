import { describe, it, expect } from 'vitest';
import { mergeTailored, buildTailorMessages, TAILOR_PROMPT } from './resumeTailor';
import type { ResumeDoc } from './types';

function base(): ResumeDoc {
  return {
    basics: { name: 'Vamsi', label: 'Senior Frontend Engineer', email: 'v@x.com', location: 'Boston, MA', summary: 'Frontend engineer.' },
    work: [
      { name: 'JPMorgan', position: 'Senior Frontend Dev', startDate: '2021', endDate: 'Present', highlights: ['Built React apps', 'Led migration'] },
      { name: 'Yash', position: 'Frontend Dev', startDate: '2018', endDate: '2021', highlights: ['Maintained Angular app'] },
    ],
    education: [{ institution: 'Hult', studyType: 'MS', area: 'Business Analytics' }],
    skills: [{ name: 'Frontend', keywords: ['React', 'TypeScript', 'GraphQL'] }],
    projects: [{ name: 'Proj', description: 'A thing', highlights: ['did x'] }],
  };
}

describe('mergeTailored — structural anti-fabrication', () => {
  it('keeps employers, titles, and dates from the base even if the model changes them', () => {
    const tailored: ResumeDoc = {
      ...base(),
      work: [
        { name: 'Google', position: 'Staff Engineer', startDate: '2015', endDate: 'Present', highlights: ['Reframed bullet'] },
        { name: 'Yash', position: 'Frontend Dev', startDate: '2018', endDate: '2021', highlights: ['Reframed angular'] },
      ],
    };
    const out = mergeTailored(base(), tailored);
    expect(out.work[0].name).toBe('JPMorgan'); // model's "Google" rejected
    expect(out.work[0].position).toBe('Senior Frontend Dev');
    expect(out.work[0].startDate).toBe('2021');
    expect(out.work[0].highlights).toEqual(['Reframed bullet']); // wording accepted
  });

  it('drops skills the candidate does not actually have (invented by the model)', () => {
    const tailored: ResumeDoc = {
      ...base(),
      skills: [{ name: 'Frontend', keywords: ['React', 'Kubernetes', 'Rust'] }], // Kubernetes/Rust invented
    };
    const out = mergeTailored(base(), tailored);
    expect(out.skills[0].keywords).toEqual(['React']);
  });

  it('allows re-ordering/regrouping of real skills', () => {
    const tailored: ResumeDoc = {
      ...base(),
      skills: [
        { name: 'Languages', keywords: ['TypeScript'] },
        { name: 'APIs', keywords: ['GraphQL'] },
      ],
    };
    const out = mergeTailored(base(), tailored);
    expect(out.skills).toEqual([
      { name: 'Languages', keywords: ['TypeScript'] },
      { name: 'APIs', keywords: ['GraphQL'] },
    ]);
  });

  it('falls back to base skills when the model returns only invented ones', () => {
    const tailored: ResumeDoc = { ...base(), skills: [{ name: 'X', keywords: ['Fortran'] }] };
    const out = mergeTailored(base(), tailored);
    expect(out.skills).toEqual(base().skills);
  });

  it('accepts a reworded summary/label but keeps identity fields', () => {
    const tailored: ResumeDoc = { ...base(), basics: { ...base().basics, name: 'HACKED', email: 'evil@x.com', summary: 'Tailored summary.' } };
    const out = mergeTailored(base(), tailored);
    expect(out.basics.name).toBe('Vamsi');
    expect(out.basics.email).toBe('v@x.com');
    expect(out.basics.summary).toBe('Tailored summary.');
  });

  it('never tailors education — copies it verbatim', () => {
    const tailored: ResumeDoc = { ...base(), education: [{ institution: 'MIT', studyType: 'PhD' }] };
    expect(mergeTailored(base(), tailored).education).toEqual(base().education);
  });

  it('keeps base highlights when the model omits an entry', () => {
    const tailored: ResumeDoc = { ...base(), work: [{ name: 'JPMorgan', highlights: [] }] };
    const out = mergeTailored(base(), tailored);
    expect(out.work[0].highlights).toEqual(base().work[0].highlights); // empty → base
    expect(out.work[1].highlights).toEqual(base().work[1].highlights); // missing → base
  });
});

describe('buildTailorMessages', () => {
  it('uses the tailor prompt and includes the job + matched signals', () => {
    const msgs = buildTailorMessages(base(), { title: 'FE Eng', company: 'Acme', full_description: 'Need React.' }, { matched: ['React'], missing: 'Kubernetes' });
    expect(msgs[0]).toEqual({ role: 'system', content: TAILOR_PROMPT });
    expect(msgs[1].content).toContain('Acme');
    expect(msgs[1].content).toContain('React');
    expect(msgs[1].content).toContain('Kubernetes');
  });
});
