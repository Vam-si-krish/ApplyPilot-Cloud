import { describe, expect, it } from 'vitest';
import { assistantApplicationAnswers, globalTailoringInstructions, normalizeCandidatePreferences, resolveTailoringPolicy, scoringPreferences } from './candidatePreferences';

describe('candidate preferences', () => {
  it('keeps supported values and drops unknown or malformed prompt data', () => {
    const value = normalizeCandidatePreferences({
      avoid_security_clearance_jobs: true,
      avoid_citizenship_restricted_jobs: 'yes',
      scoring_instructions: ' Prefer product companies ',
      tailoring_instructions: 'Lead with platform work',
      skill_addition_mode: 'learnable',
      skill_learning_horizon_days: 30,
      title_alignment: 'preserve',
      experience_shortfall_tolerance_years: 2,
      contract_role_treatment: 'avoid',
      evidence_standard: 'anything',
      application_answers: { willing_to_relocate: false, preferred_work_arrangement: 'Hybrid', secret: 'drop' },
      injected: 'drop',
    });
    expect(value).toEqual({
      avoid_security_clearance_jobs: true,
      scoring_instructions: 'Prefer product companies',
      tailoring_instructions: 'Lead with platform work',
      skill_addition_mode: 'learnable',
      skill_learning_horizon_days: 30,
      title_alignment: 'preserve',
      experience_shortfall_tolerance_years: 2,
      contract_role_treatment: 'avoid',
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
    expect(scoringPreferences(value)).toEqual({
      avoid_security_clearance_jobs: true,
      scoring_instructions: 'Prefer healthcare',
      experience_shortfall_tolerance_years: 3,
      overqualification_treatment: 'ignore',
      contract_role_treatment: 'neutral',
    });
    expect(globalTailoringInstructions(value)).toContain('within 15 days');
    expect(globalTailoringInstructions(value)).toContain('Use a concise summary');
    expect(assistantApplicationAnswers(value)).toEqual({ additional_facts: 'Private interview fact' });
  });

  it('resolves safe defaults and honors a validated 30-day learning window', () => {
    expect(resolveTailoringPolicy({})).toEqual({
      skillAdditionMode: 'learnable',
      skillLearningHorizonDays: 15,
      titleAlignment: 'honest_reframe',
      evidenceStandard: 'plausible_with_review',
      useJobLocation: false,
    });
    expect(globalTailoringInstructions({ skill_learning_horizon_days: 30 })).toContain('within 30 days');
    expect(resolveTailoringPolicy({ skill_learning_horizon_days: 365 }).skillLearningHorizonDays).toBe(15);
  });
});
