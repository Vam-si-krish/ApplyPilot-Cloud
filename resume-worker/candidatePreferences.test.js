import test from 'node:test';
import assert from 'node:assert/strict';
import {
  combinedTailoringInstructions,
  normalizeCandidatePreferences,
  resolveTailoringPolicy,
  scoringPreferences,
} from './candidatePreferences.js';

test('worker candidate preferences validate values and mirror direct-path defaults', () => {
  assert.deepEqual(normalizeCandidatePreferences({
    skill_learning_horizon_days: 30,
    title_alignment: 'preserve',
    experience_shortfall_tolerance_years: 4,
    contract_role_treatment: 'avoid',
    overqualification_treatment: 'invalid',
  }), {
    skill_learning_horizon_days: 30,
    title_alignment: 'preserve',
    experience_shortfall_tolerance_years: 4,
    contract_role_treatment: 'avoid',
  });
  assert.deepEqual(scoringPreferences({}), {
    experience_shortfall_tolerance_years: 3,
    overqualification_treatment: 'ignore',
    contract_role_treatment: 'neutral',
  });
});

test('worker tailoring instructions carry the validated horizon and both guidance levels', () => {
  const preferences = {
    skill_addition_mode: 'learnable',
    skill_learning_horizon_days: 30,
    tailoring_instructions: 'Lead with API work',
  };
  assert.equal(resolveTailoringPolicy(preferences).skillLearningHorizonDays, 30);
  const instructions = combinedTailoringInstructions(preferences, 'Mention the migration');
  assert.match(instructions, /within 30 days/);
  assert.match(instructions, /Lead with API work/);
  assert.match(instructions, /Mention the migration/);
  // Header-location judgment (ADR 0112) rides the instructions only when opted in.
  assert.doesNotMatch(instructions, /resume_location/);
  assert.match(
    combinedTailoringInstructions({ ...preferences, use_job_location_on_tailored_resume: true }),
    /resume_location.*same metro/s,
  );
});
