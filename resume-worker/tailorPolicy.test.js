import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeTailored } from './tailor.js';

const base = {
  basics: { name: 'Jordan', label: 'Software Engineer', summary: 'Builds applications.' },
  work: [{ name: 'Acme', position: 'Software Engineer', startDate: '2022', endDate: 'Present', highlights: ['Built APIs'] }],
  education: [],
  skills: [{ name: 'Core', keywords: ['TypeScript'] }],
  projects: [],
};

test('worker merge enforces strict skill and title controls after generation', () => {
  const tailored = {
    ...base,
    basics: { ...base.basics, label: 'Staff Rust Engineer' },
    work: [{ ...base.work[0], position: 'Platform Architect', highlights: ['Reframed API work'] }],
    skills: [{ name: 'New', keywords: ['Rust', 'Kubernetes'] }],
  };
  const result = mergeTailored(base, tailored, {
    skillAdditionMode: 'evidenced_only',
    skillLearningHorizonDays: 30,
    titleAlignment: 'preserve',
    evidenceStandard: 'base_only',
  });
  assert.equal(result.basics.label, 'Software Engineer');
  assert.equal(result.work[0].position, 'Software Engineer');
  assert.deepEqual(result.skills, base.skills);
});
