import { describe, it, expect } from 'vitest';
import {
  tokenize,
  computeIdf,
  coverageScore,
  stripHtml,
  findSkills,
  titleAlignment,
  jdRequiredYears,
  resumeYearsOfExperience,
  requiresAdvancedDegree,
  clearanceRestricted,
  atsMatchScores,
} from './prefilter';

const RESUME = `Vamsi K
Software Engineer
Full-stack engineer with React, TypeScript, Node.js and AWS.

EXPERIENCE
Software Engineer — Acme  Jan 2019 to Present
- Built React + TypeScript frontends and Node.js services on AWS (Lambda, S3)
- Set up CI/CD with GitHub Actions and Docker; PostgreSQL and Redis storage

EDUCATION
Master of Science, Computer Science, State University

SKILLS
Languages: JavaScript, TypeScript, Python
Frontend: React, Next.js, Tailwind
Cloud: AWS, Docker, Kubernetes`;

describe('tokenize (v1 primitive)', () => {
  it('lowercases, drops stopwords, and keeps tech tokens', () => {
    const toks = tokenize('Senior C++ and React.js engineer with the Node.js stack');
    expect(toks).toContain('c++');
    expect(toks).toContain('react.js');
    expect(toks).toContain('node.js');
    expect(toks).toContain('engineer');
    expect(toks).not.toContain('and');
    expect(toks).not.toContain('the');
    expect(toks).not.toContain('with');
  });

  it('drops sub-2-char tokens and trims trailing dots', () => {
    expect(tokenize('a in node.')).toEqual(['node']);
  });
});

describe('computeIdf / coverageScore (v1 primitives)', () => {
  it('gives a term in every document zero weight, and rarer terms more', () => {
    const idf = computeIdf([
      ['react', 'common'],
      ['python', 'common'],
    ]);
    expect(idf.get('common')).toBe(0);
    expect(idf.get('react')!).toBeGreaterThan(0);
  });

  it('coverage is higher when the résumé covers the job\'s weighted terms', () => {
    const idf = computeIdf([
      ['react', 'typescript', 'node'],
      ['react', 'typescript', 'aws'],
      ['nursing', 'patient', 'care'],
    ]);
    const resume = new Set(['react', 'typescript', 'node', 'aws']);
    expect(coverageScore(resume, ['react', 'typescript', 'aws'], idf)).toBeGreaterThan(
      coverageScore(resume, ['nursing', 'patient', 'care'], idf),
    );
  });
});

describe('stripHtml', () => {
  it('removes tags, decodes entities, and keeps line structure for section detection', () => {
    const text = stripHtml('<p>Requirements:</p><ul><li>React &amp; TypeScript</li><li>5+ years</li></ul>');
    expect(text).not.toContain('<');
    expect(text).toContain('React & TypeScript');
    expect(text.split('\n').length).toBeGreaterThanOrEqual(3); // block tags became newlines
  });
});

describe('findSkills', () => {
  it('normalizes aliases to canonical skills', () => {
    const skills = findSkills('We use K8s, Postgres, React.js and Node');
    expect(skills.has('kubernetes')).toBe(true);
    expect(skills.has('postgresql')).toBe(true);
    expect(skills.has('react')).toBe(true);
    expect(skills.has('node.js')).toBe(true);
  });

  it('matches multi-word skills greedily ("react native" is not also "react")', () => {
    const skills = findSkills('Experience with React Native and machine learning required');
    expect(skills.has('react native')).toBe(true);
    expect(skills.has('react')).toBe(false);
    expect(skills.has('machine learning')).toBe(true);
  });

  it('does not fire on lookalike boilerplate (go-to-market, the rest of the team)', () => {
    const skills = findSkills('Own the go-to-market plan with the rest of the team');
    expect(skills.has('golang')).toBe(false);
    expect(skills.size).toBe(0);
  });

  it('counts occurrences for frequency weighting', () => {
    expect(findSkills('React, React and more React').get('react')).toBe(3);
  });
});

describe('titleAlignment', () => {
  const resumeTerms = new Set(['engineer', 'software', 'react', 'fullstack']);
  it('ignores seniority words and treats developer≈engineer', () => {
    expect(titleAlignment('Senior Software Developer', resumeTerms)).toBe(100);
  });
  it('scores an unrelated title low', () => {
    expect(titleAlignment('Registered Nurse', resumeTerms)).toBe(0);
  });
  it('returns null when the title has no content words', () => {
    expect(titleAlignment('Senior II (Remote)', resumeTerms)).toBeNull();
  });
});

describe('requirement extraction', () => {
  it('finds the highest years requirement', () => {
    expect(jdRequiredYears('3+ years with React and 7+ years of engineering experience')).toBe(7);
    expect(jdRequiredYears('no years mentioned')).toBeNull();
  });

  it('estimates résumé career span from date ranges (incl. "to Present" and month names)', () => {
    const y = resumeYearsOfExperience('Engineer  Jan 2019 to Mar 2023\nIntern 2017 - 2018', new Date('2026-07-01'));
    expect(y).toBe(6); // 2017 → 2023
    expect(resumeYearsOfExperience('no dates here')).toBeNull();
  });

  it('detects a required advanced degree but not a preferred one', () => {
    expect(requiresAdvancedDegree("Master's degree required")).toBe(true);
    expect(requiresAdvancedDegree("Master's degree preferred")).toBe(false);
    expect(requiresAdvancedDegree("Bachelor's degree required")).toBe(false);
  });

  it('flags clearance / citizenship-restricted postings', () => {
    expect(clearanceRestricted('Active TS/SCI clearance required')).toBe(true);
    expect(clearanceRestricted('Must be a U.S. citizen')).toBe(true);
    expect(clearanceRestricted('Authorized to work in the US')).toBe(false);
  });
});

describe('atsMatchScores', () => {
  const jobs = [
    {
      id: 'swe',
      title: 'Senior Frontend Engineer',
      text: `<p>We build dashboards.</p>
<p>Requirements:</p><ul><li>React and TypeScript</li><li>Node.js services on AWS</li><li>CI/CD pipelines</li></ul>
<p>Nice to have:</p><ul><li>Kubernetes</li></ul>`,
    },
    {
      id: 'nurse',
      title: 'Registered Nurse',
      text: 'Provide bedside patient care in the ICU ward. BLS certification and nursing license required.',
    },
    {
      id: 'cleared',
      title: 'Frontend Engineer',
      text: 'React and TypeScript. Active TS/SCI clearance required. US citizenship required.',
    },
  ];

  it('scores a matching job well above an unrelated one', () => {
    const scores = atsMatchScores({ text: RESUME }, jobs);
    const swe = scores.get('swe')!;
    const nurse = scores.get('nurse')!;
    expect(swe.score).toBeGreaterThanOrEqual(60);
    expect(nurse.score).toBeLessThanOrEqual(25);
    expect(swe.score).toBeGreaterThan(nurse.score + 30); // meaningful spread, not a cluster
  });

  it('reports matched/missing skills in the breakdown', () => {
    const swe = atsMatchScores({ text: RESUME }, jobs).get('swe')!;
    expect(swe.breakdown.matched).toContain('react');
    expect(swe.breakdown.matched).toContain('typescript');
    expect(swe.breakdown.skills).not.toBeNull();
    expect(swe.breakdown.title).not.toBeNull();
  });

  it('caps clearance-restricted jobs at 5 even when skills match', () => {
    const cleared = atsMatchScores({ text: RESUME }, jobs).get('cleared')!;
    expect(cleared.score).toBeLessThanOrEqual(5);
    expect(cleared.breakdown.flags.join(' ')).toMatch(/clearance/);
  });

  it('counts the user\'s Settings→Skills as résumé skills', () => {
    const job = [{ id: 'j', title: 'Verilog Engineer', text: 'Requirements: Verilog and React' }];
    const without = atsMatchScores({ text: RESUME }, job).get('j')!;
    const withSkill = atsMatchScores({ text: RESUME, skills: ['Verilog'] }, job).get('j')!;
    expect(withSkill.score).toBeGreaterThan(without.score);
  });

  it('penalizes a big years-of-experience gap', () => {
    const shortResume = 'Software Engineer\nReact and TypeScript apps.\nEngineer 2024 - Present';
    const job = [{ id: 'j', title: 'Engineer', text: 'React and TypeScript. 10+ years of experience required.' }];
    const r = atsMatchScores({ text: shortResume }, job).get('j')!;
    expect(r.breakdown.flags.join(' ')).toMatch(/10\+ yrs/);
  });

  it('returns an empty map when the résumé is empty (caller treats null as pass)', () => {
    expect(atsMatchScores({ text: '' }, jobs).size).toBe(0);
  });
});
