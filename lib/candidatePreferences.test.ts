import { describe, expect, it } from 'vitest';
import { assistantApplicationAnswers, globalTailoringInstructions, normalizeCandidatePreferences, scoringPreferences } from './candidatePreferences';

describe('candidate preferences', () => {
  it('keeps supported values and drops unknown or malformed prompt data', () => {
    const value = normalizeCandidatePreferences({
      avoid_security_clearance_jobs: true,
      avoid_citizenship_restricted_jobs: 'yes',
      scoring_instructions: ' Prefer product companies ',
      tailoring_instructions: 'Lead with platform work',
      application_answers: { willing_to_relocate: false, preferred_work_arrangement: 'Hybrid', secret: 'drop' },
      injected: 'drop',
    });
    expect(value).toEqual({
      avoid_security_clearance_jobs: true,
      scoring_instructions: 'Prefer product companies',
      tailoring_instructions: 'Lead with platform work',
      application_answers: { willing_to_relocate: false, preferred_work_arrangement: 'Hybrid' },
    });
  });

  it('keeps scoring and tailoring contexts purpose-limited', () => {
    const value = {
      avoid_security_clearance_jobs: true,
      scoring_instructions: 'Prefer healthcare',
      tailoring_instructions: 'Use a concise summary',
      application_answers: { additional_facts: 'Private interview fact' },
    };
    expect(scoringPreferences(value)).toEqual({ avoid_security_clearance_jobs: true, scoring_instructions: 'Prefer healthcare' });
    expect(globalTailoringInstructions(value)).toBe('Use a concise summary');
    expect(assistantApplicationAnswers(value)).toEqual({ additional_facts: 'Private interview fact' });
  });
});
