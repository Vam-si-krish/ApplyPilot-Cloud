const VALUES = {
  skill_addition_mode: new Set(['evidenced_only', 'adjacent_only', 'learnable']),
  skill_learning_horizon_days: new Set([7, 15, 30, 60]),
  title_alignment: new Set(['preserve', 'honest_reframe']),
  evidence_standard: new Set(['base_only', 'plausible_with_review']),
  experience_shortfall_tolerance_years: new Set([0, 1, 2, 3, 4, 5]),
  overqualification_treatment: new Set(['ignore', 'note', 'small_penalty']),
  contract_role_treatment: new Set(['neutral', 'note', 'avoid']),
};

function boundedText(value, max) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}

export function normalizeCandidatePreferences(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out = {};
  for (const key of ['avoid_security_clearance_jobs', 'avoid_citizenship_restricted_jobs']) {
    if (typeof value[key] === 'boolean') out[key] = value[key];
  }
  for (const key of ['scoring_instructions', 'tailoring_instructions']) {
    const normalized = boundedText(value[key], 4000);
    if (normalized) out[key] = normalized;
  }
  for (const [key, choices] of Object.entries(VALUES)) {
    if (choices.has(value[key])) out[key] = value[key];
  }
  return out;
}

export function scoringPreferences(value) {
  const p = normalizeCandidatePreferences(value);
  return {
    ...(typeof p.avoid_security_clearance_jobs === 'boolean'
      ? { avoid_security_clearance_jobs: p.avoid_security_clearance_jobs }
      : {}),
    ...(typeof p.avoid_citizenship_restricted_jobs === 'boolean'
      ? { avoid_citizenship_restricted_jobs: p.avoid_citizenship_restricted_jobs }
      : {}),
    ...(p.scoring_instructions ? { scoring_instructions: p.scoring_instructions } : {}),
    experience_shortfall_tolerance_years: p.experience_shortfall_tolerance_years ?? 3,
    overqualification_treatment: p.overqualification_treatment ?? 'ignore',
    contract_role_treatment: p.contract_role_treatment ?? 'neutral',
  };
}

export function resolveTailoringPolicy(value) {
  const p = normalizeCandidatePreferences(value);
  return {
    skillAdditionMode: p.skill_addition_mode ?? 'learnable',
    skillLearningHorizonDays: p.skill_learning_horizon_days ?? 15,
    titleAlignment: p.title_alignment ?? 'honest_reframe',
    evidenceStandard: p.evidence_standard ?? 'plausible_with_review',
  };
}

export function combinedTailoringInstructions(value, perJob = '') {
  const p = normalizeCandidatePreferences(value);
  const policy = resolveTailoringPolicy(p);
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
  const local = boundedText(perJob, 2000);
  return [
    'VALIDATED TAILORING CONTROLS (these refine the protected system rules):',
    `- Skills: ${skillRule}`,
    `- Titles: ${titleRule}`,
    `- Evidence: ${evidenceRule}`,
    p.tailoring_instructions ? `\nGLOBAL CANDIDATE GUIDANCE:\n${p.tailoring_instructions}` : '',
    local ? `\nJOB-SPECIFIC GUIDANCE:\n${local}` : '',
  ].filter(Boolean).join('\n');
}
