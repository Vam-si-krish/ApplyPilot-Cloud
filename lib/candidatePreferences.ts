import type { CandidatePreferences } from './types';

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

/** Defensive API boundary for user-authored prompt guidance and application facts. */
export function normalizeCandidatePreferences(value: unknown): CandidatePreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const result: CandidatePreferences = {};
  for (const key of ['avoid_security_clearance_jobs', 'avoid_citizenship_restricted_jobs'] as const) {
    if (typeof source[key] === 'boolean') result[key] = source[key];
  }
  const scoring = text(source.scoring_instructions, 4000);
  const tailoring = text(source.tailoring_instructions, 4000);
  if (scoring) result.scoring_instructions = scoring;
  if (tailoring) result.tailoring_instructions = tailoring;

  const rawAnswers = source.application_answers;
  if (rawAnswers && typeof rawAnswers === 'object' && !Array.isArray(rawAnswers)) {
    const answersSource = rawAnswers as Record<string, unknown>;
    const answers: NonNullable<CandidatePreferences['application_answers']> = {};
    if (typeof answersSource.willing_to_relocate === 'boolean' || answersSource.willing_to_relocate === null) {
      answers.willing_to_relocate = answersSource.willing_to_relocate as boolean | null;
    }
    for (const key of ['preferred_work_arrangement', 'available_start', 'employment_types', 'salary_expectation'] as const) {
      const normalized = text(answersSource[key], 500);
      if (normalized) answers[key] = normalized;
    }
    const additional = text(answersSource.additional_facts, 4000);
    if (additional) answers.additional_facts = additional;
    if (Object.keys(answers).length) result.application_answers = answers;
  }
  return result;
}

/** Only scorer-relevant preferences enter the scoring cache/context. */
export function scoringPreferences(value: unknown): Record<string, unknown> {
  const normalized = normalizeCandidatePreferences(value);
  return {
    ...(typeof normalized.avoid_security_clearance_jobs === 'boolean'
      ? { avoid_security_clearance_jobs: normalized.avoid_security_clearance_jobs }
      : {}),
    ...(typeof normalized.avoid_citizenship_restricted_jobs === 'boolean'
      ? { avoid_citizenship_restricted_jobs: normalized.avoid_citizenship_restricted_jobs }
      : {}),
    ...(normalized.scoring_instructions ? { scoring_instructions: normalized.scoring_instructions } : {}),
  };
}

export function globalTailoringInstructions(value: unknown): string {
  return normalizeCandidatePreferences(value).tailoring_instructions || '';
}

/** ApplyBuddy receives recurring application answers, never scorer/tailorer prompt text. */
export function assistantApplicationAnswers(value: unknown): Record<string, unknown> {
  return normalizeCandidatePreferences(value).application_answers || {};
}
