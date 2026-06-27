import { describe, it, expect } from 'vitest';
import { mergeTailored, addedSkills, buildTailorMessages, TAILOR_PROMPT, totalExperienceYears, clampYoeClaims } from './resumeTailor';
import { normalizeResume } from './resume';
import type { ContentPart } from './llm';
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

describe('mergeTailored — anchor verifiable facts, allow enhancement (ADR 0026)', () => {
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

  it('KEEPS added skills the model introduces (enhancement allowed)', () => {
    const tailored: ResumeDoc = {
      ...base(),
      skills: [{ name: 'Frontend', keywords: ['React', 'Kubernetes', 'Rust'] }], // Kubernetes/Rust added
    };
    const out = mergeTailored(base(), tailored);
    expect(out.skills[0].keywords).toEqual(['React', 'Kubernetes', 'Rust']);
  });

  it('allows re-ordering/regrouping of skills', () => {
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

  it('falls back to base skills only when the model returns no skills at all', () => {
    const out = mergeTailored(base(), { ...base(), skills: [] });
    expect(out.skills).toEqual(base().skills);
  });

  it('addedSkills reports what the AI introduced beyond the base', () => {
    const merged = mergeTailored(base(), { ...base(), skills: [{ name: 'Frontend', keywords: ['React', 'Kubernetes', 'WebSockets'] }] });
    expect(addedSkills(base(), merged)).toEqual(['Kubernetes', 'WebSockets']); // React was already in base
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

  it('handles the patch-shaped model output — partial fields, omitted identity/education (ADR 0031)', () => {
    // The model now emits only the fields we keep; everything else is restored from base.
    const patch = {
      basics: { summary: 'Tailored.', label: 'Senior FE' },
      work: [
        { name: 'JPMorgan', highlights: ['New bullet A'] },
        { name: 'Yash', highlights: ['New bullet B'] },
      ],
      skills: [{ name: 'Frontend', keywords: ['React', 'Next.js'] }],
      projects: [{ name: 'Proj', highlights: ['proj bullet'] }],
      _changes: ['Added Next.js'],
    };
    const out = mergeTailored(base(), normalizeResume(patch));
    expect(out.basics.name).toBe('Vamsi'); // restored from base (patch omits it)
    expect(out.basics.email).toBe('v@x.com'); // restored
    expect(out.basics.summary).toBe('Tailored.'); // taken from patch
    expect(out.work[0].name).toBe('JPMorgan'); // anchored
    expect(out.work[0].highlights).toEqual(['New bullet A']);
    expect(out.education).toEqual(base().education); // restored (patch omits education entirely)
    expect(out.skills[0].keywords).toContain('Next.js');
  });
});

describe('mergeTailored — deterministic one-page caps (ADR 0031)', () => {
  it('hard-caps an over-long summary to the budget', () => {
    const longSummary = 'word '.repeat(200); // ~1000 chars
    const out = mergeTailored(base(), { ...base(), basics: { ...base().basics, summary: longSummary } });
    // base summary is short → budget floor is 320 chars
    expect(out.basics.summary!.length).toBeLessThanOrEqual(320);
  });

  it('caps the total number of skill keywords (long list also overflows the page)', () => {
    const many = Array.from({ length: 30 }, (_, i) => `skill${i}`);
    const out = mergeTailored(base(), { ...base(), skills: [{ name: 'All', keywords: many }] });
    const total = out.skills.reduce((n, g) => n + g.keywords.length, 0);
    // base has 3 keywords → budget = max(3+6, ceil(3*1.4)=5) = 9
    expect(total).toBe(9);
  });

  it('strips em-dashes from generated bullets (AI tell) but keeps hyphenated compounds (ADR 0033)', () => {
    const tailored: ResumeDoc = {
      ...base(),
      work: [
        { name: 'JPMorgan', highlights: ['Built cross-browser UIs — cutting latency 20% — across modules', 'Led migration'] },
        { name: 'Yash', highlights: ['Maintained Angular app'] },
      ],
    };
    const out = mergeTailored(base(), tailored);
    expect(out.work[0].highlights[0]).toBe('Built cross-browser UIs, cutting latency 20%, across modules');
    expect(out.work[0].highlights[0]).not.toContain('—'); // em-dash gone
    expect(out.work[0].highlights[0]).toContain('cross-browser'); // hyphen preserved
  });
});

describe('buildTailorMessages', () => {
  it('puts the base résumé + budget in a cached prefix and the job in the volatile tail', () => {
    const msgs = buildTailorMessages(base(), { title: 'FE Eng', company: 'Acme', full_description: 'Need React.' }, { matched: ['React'], missing: 'Kubernetes' });
    expect(msgs[0]).toEqual({ role: 'system', content: TAILOR_PROMPT });

    const parts = msgs[1].content as ContentPart[];
    expect(parts[0].cache).toBe(true); // base + length budget = the cached prefix
    expect(parts[0].text).toContain('BASE RÉSUMÉ');
    expect(parts[0].text).toContain('LENGTH BUDGET');
    expect(parts[0].text).toContain('TOTAL PROFESSIONAL EXPERIENCE'); // the true-years ceiling (ADR 0041)
    expect(parts[1].cache).toBeUndefined(); // per-job tail is not cached
    expect(parts[1].text).toContain('Acme');
    expect(parts[1].text).toContain('React');
    expect(parts[1].text).toContain('Kubernetes');
  });
});

describe('totalExperienceYears — true career span from dates (ADR 0041)', () => {
  it('spans earliest start to latest end, flooring; an ongoing role counts to now', () => {
    const b: ResumeDoc = {
      ...base(),
      work: [
        { name: 'A', startDate: '2021', endDate: 'Present', highlights: [] },
        { name: 'B', startDate: '2018-06', endDate: '2021', highlights: [] },
      ],
    };
    expect(totalExperienceYears(b, new Date('2024-07-01'))).toBe(6); // 2018.5 → 2024.5
  });

  it('parses month names and MM/YYYY', () => {
    const b: ResumeDoc = { ...base(), work: [{ name: 'A', startDate: 'Mar 2019', endDate: '06/2025', highlights: [] }] };
    expect(totalExperienceYears(b, new Date('2026-01-01'))).toBe(6); // 2019.17 → 2025.42
  });

  it('returns null when no employment date parses (cannot bound the claim)', () => {
    expect(totalExperienceYears({ ...base(), work: [{ name: 'A', highlights: [] }] })).toBeNull();
  });
});

describe('clampYoeClaims — deterministic anti-inflation guard (ADR 0041)', () => {
  it('clamps a claim above the true span down to it', () => {
    expect(clampYoeClaims('8+ years of experience', 6)).toBe('6+ years of experience');
    expect(clampYoeClaims('over 10 years', 6)).toBe('over 6 years');
    expect(clampYoeClaims('9 yrs in frontend', 6)).toBe('6 yrs in frontend');
  });

  it('leaves a truthful claim within range untouched', () => {
    expect(clampYoeClaims('5 years of experience', 6)).toBe('5 years of experience');
    expect(clampYoeClaims('6+ years', 6)).toBe('6+ years');
  });

  it('is a no-op when the span is unknown', () => {
    expect(clampYoeClaims('8+ years', null)).toBe('8+ years');
  });

  it('ignores four-digit years and unrelated numbers', () => {
    expect(clampYoeClaims('shipped in 2019 across 12 teams', 6)).toBe('shipped in 2019 across 12 teams');
  });

  it('is applied through mergeTailored so an inflated summary cannot reach the résumé', () => {
    const max = totalExperienceYears(base())!; // base spans 2018→present
    const tailored: ResumeDoc = { ...base(), basics: { ...base().basics, summary: 'React developer with 25+ years of experience building UIs.' } };
    const out = mergeTailored(base(), tailored);
    expect(out.basics.summary).toContain(`${max}+ years of experience`);
    expect(out.basics.summary).not.toContain('25');
  });
});
