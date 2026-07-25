import type { CandidatePreferences } from './types';

export interface TailoringPolicy {
  skillAdditionMode: 'evidenced_only' | 'adjacent_only' | 'learnable';
  skillLearningHorizonDays: 7 | 15 | 30 | 60;
  titleAlignment: 'preserve' | 'honest_reframe';
  evidenceStandard: 'base_only' | 'plausible_with_review';
  useJobLocation?: boolean;
}

export const DEFAULT_TAILORING_POLICY: TailoringPolicy = {
  skillAdditionMode: 'learnable',
  skillLearningHorizonDays: 15,
  titleAlignment: 'honest_reframe',
  evidenceStandard: 'plausible_with_review',
  useJobLocation: false,
};

const VALID_VALUES = {
  skill_addition_mode: ['evidenced_only', 'adjacent_only', 'learnable'],
  skill_learning_horizon_days: [7, 15, 30, 60],
  title_alignment: ['preserve', 'honest_reframe'],
  evidence_standard: ['base_only', 'plausible_with_review'],
  experience_shortfall_tolerance_years: [0, 1, 2, 3, 4, 5],
  overqualification_treatment: ['ignore', 'note', 'small_penalty'],
  contract_role_treatment: ['neutral', 'note', 'avoid'],
} as const;

function allowed<K extends keyof typeof VALID_VALUES>(key: K, value: unknown): boolean {
  return (VALID_VALUES[key] as readonly unknown[]).includes(value);
}

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
  for (const key of ['avoid_security_clearance_jobs', 'avoid_citizenship_restricted_jobs', 'use_job_location_on_tailored_resume'] as const) {
    if (typeof source[key] === 'boolean') result[key] = source[key];
  }
  const scoring = text(source.scoring_instructions, 4000);
  const tailoring = text(source.tailoring_instructions, 4000);
  if (scoring) result.scoring_instructions = scoring;
  if (tailoring) result.tailoring_instructions = tailoring;
  for (const key of Object.keys(VALID_VALUES) as (keyof typeof VALID_VALUES)[]) {
    if (allowed(key, source[key])) {
      // The runtime membership check above narrows values more precisely than TS can infer
      // across this heterogeneous preference map.
      Object.assign(result, { [key]: source[key] });
    }
  }

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
    experience_shortfall_tolerance_years: normalized.experience_shortfall_tolerance_years ?? 3,
    overqualification_treatment: normalized.overqualification_treatment ?? 'ignore',
    contract_role_treatment: normalized.contract_role_treatment ?? 'neutral',
  };
}

export function resolveTailoringPolicy(value: unknown): TailoringPolicy {
  const normalized = normalizeCandidatePreferences(value);
  return {
    skillAdditionMode: normalized.skill_addition_mode ?? DEFAULT_TAILORING_POLICY.skillAdditionMode,
    skillLearningHorizonDays: normalized.skill_learning_horizon_days ?? DEFAULT_TAILORING_POLICY.skillLearningHorizonDays,
    titleAlignment: normalized.title_alignment ?? DEFAULT_TAILORING_POLICY.titleAlignment,
    evidenceStandard: normalized.evidence_standard ?? DEFAULT_TAILORING_POLICY.evidenceStandard,
    useJobLocation: normalized.use_job_location_on_tailored_resume ?? false,
  };
}

/** Opt-in header-location judgment (ADR 0112): the model decides between the home
 *  location and the job's city — same-metro/remote/vague cases keep home. */
export const HEADER_LOCATION_RULE =
  'Header location: output a top-level "resume_location" string field, the location to print in this copy\'s header. '
  + 'Judge it from the TARGET JOB\'s Location line and the Base résumé\'s home location: if the job is remote, its '
  + 'location is missing or a vague region (e.g. "United States"), or it is within the same metro/commuting area as '
  + 'the home location (e.g. Cambridge, MA for a Boston, MA candidate), return the home location EXACTLY as the base '
  + 'writes it. Only when the job is clearly in a DIFFERENT metro area, return the job\'s city as "City, ST" for US '
  + 'cities or "City, Country" elsewhere (e.g. "Austin, TX", never "Greater Austin Area"). Never output a street address.';

export function globalTailoringInstructions(value: unknown): string {
  const normalized = normalizeCandidatePreferences(value);
  const policy = resolveTailoringPolicy(normalized);
  const skillRule = policy.skillAdditionMode === 'evidenced_only'
    ? 'Keep the Base résumé skill list unchanged; do not add missing or adjacent skills.'
    : policy.skillAdditionMode === 'adjacent_only'
      ? 'Add only skills closely adjacent to skills already evidenced in the Base résumé.'
      : `Add a missing skill only when it is adjacent or credibly learnable within ${policy.skillLearningHorizonDays} days.`;
  const titleRule = policy.titleAlignment === 'preserve'
    ? 'Preserve the Base résumé headline and every official role title.'
    : 'Honestly align the headline and role disciplines to the target; never change seniority.';
  const evidenceRule = policy.evidenceStandard === 'base_only'
    ? 'Use only achievements, metrics, scope, and supporting details stated in the Base résumé; rephrase and reorder, but do not invent.'
    : 'Plausible supporting detail may be drafted when consistent with the real role, but every material addition must be disclosed for review.';
  return [
    'VALIDATED TAILORING CONTROLS (these refine the protected system rules):',
    `- Skills: ${skillRule}`,
    `- Titles: ${titleRule}`,
    `- Evidence: ${evidenceRule}`,
    policy.useJobLocation ? `- ${HEADER_LOCATION_RULE}` : '',
    normalized.tailoring_instructions ? `\nGLOBAL CANDIDATE GUIDANCE:\n${normalized.tailoring_instructions}` : '',
  ].filter(Boolean).join('\n');
}

/** ApplyBuddy receives recurring application answers, never scorer/tailorer prompt text. */
export function assistantApplicationAnswers(value: unknown): Record<string, unknown> {
  return normalizeCandidatePreferences(value).application_answers || {};
}
