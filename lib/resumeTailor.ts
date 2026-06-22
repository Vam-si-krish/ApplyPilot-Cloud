/**
 * Per-job résumé tailoring (ADR 0024, Phase 2). ONE LLM call that reframes the
 * user's REAL base résumé toward a specific job — it never fabricates.
 *
 * Two layers of anti-fabrication discipline (same spirit as the scorer):
 *   1. The prompt forbids inventing skills, employers, dates, titles, or metrics.
 *   2. `mergeTailored` enforces it structurally: factual fields (names, companies,
 *      dates, education, and the SET of skills) are taken from the base résumé, not
 *      the model. The model may only rephrase summary/highlights and re-order what
 *      already exists. So even a misbehaving model cannot add a job, a degree, or a
 *      skill the user doesn't actually have.
 *
 * Pure (`mergeTailored`) + one call (`tailorResume`) — runnable in a Netlify route
 * now and in the MacBook worker later; unit-tested directly.
 */
import { getClient, LLMClient, ChatMessage } from './llm';
import { normalizeResume, extractJsonObject } from './resume';
import type { ResumeDoc, ResumeWork, ResumeProject, ResumeSkill } from './types';

/** Scoring-v2 signals we already store, fed to the tailorer so it targets the right keywords. */
export interface TailorSignals {
  /** Must-haves the scorer flagged as missing (do NOT invent these — only surface real, related strengths). */
  missing?: string | null;
  /** The user's skills this job mentions (genuine matches — lead with these). */
  matched?: string[] | null;
  /** The user's skills the job did NOT mention. */
  unmatched?: string[] | null;
  /** Keywords the scorer extracted from the job. */
  keywords?: string | null;
}

export interface TailorJob {
  title?: string | null;
  company?: string | null;
  full_description?: string | null;
}

export const TAILOR_PROMPT = `You are an expert résumé editor. Tailor the candidate's REAL résumé to a specific job. You REFRAME truthfully — you are not a writer of fiction.

ABSOLUTE RULES (truthfulness — non-negotiable):
- Use ONLY what is in the base résumé. NEVER invent or add: skills, technologies, employers, job titles, dates, degrees, certifications, or metrics/numbers that aren't already there.
- Do NOT claim a skill the candidate doesn't list just because the job wants it. If the job needs something they lack, simply emphasize their closest REAL strengths instead.
- Keep every company name, job title, and date EXACTLY as given. Keep all education exactly as given.
- You MAY: rewrite the summary, rephrase existing bullet points to foreground the job's real requirements and keywords the candidate genuinely has, and re-order skills/bullets by relevance. Keep the same number of work entries.

GOAL: make the candidate's genuine, relevant experience obvious for THIS job — surface matching keywords that are truly theirs, lead with the most relevant bullets, and tune the summary to the role.

LENGTH & DETAIL — DO NOT arbitrarily cut down details or skills:
- Retain as much rich detail and context as possible from the base résumé to make the application as strong as possible.
- Most recent / most relevant role: expand and keep all strong, relevant bullets (do not limit them). Older roles: preserve important details rather than aggressively pruning.
- Do NOT arbitrarily cap the total number of bullets. Keep all high-impact bullets and reframe them for maximum alignment with the job.
- ALWAYS preserve all quantifiable metrics (e.g., latency reduction, user scale, performance gains) from the base résumé. Highlight these metrics strongly.
- Keep all relevant skills and skill groups intact. Do not drop skill groups just to save space.
- Make the summary highly detailed and compelling (e.g., 4-5 lines). Do not aggressively shorten it.

Output ONLY a JSON object (no markdown/commentary), the SAME shape as the input base résumé:
{
  "basics": { "name":"", "label":"", "email":"", "phone":"", "url":"", "location":"", "summary":"", "profiles":[{"network":"","url":""}] },
  "work": [ { "name":"", "position":"", "location":"", "startDate":"", "endDate":"", "highlights":["",""] } ],
  "education": [ { "institution":"", "area":"", "studyType":"", "startDate":"", "endDate":"", "score":"" } ],
  "skills": [ { "name":"", "keywords":["",""] } ],
  "projects": [ { "name":"", "description":"", "url":"", "highlights":[] } ]
}
Keep work entries in the same order and count as the base résumé.`;

export function buildTailorMessages(base: ResumeDoc, job: TailorJob, signals: TailorSignals): ChatMessage[] {
  const desc = (job.full_description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 12000);
  const matched = (signals.matched ?? []).filter(Boolean);
  const unmatched = (signals.unmatched ?? []).filter(Boolean);
  const user =
    `BASE RÉSUMÉ (the only source of truth — JSON):\n${JSON.stringify(base)}\n\n` +
    `TARGET JOB:\nTitle: ${job.title ?? 'N/A'}\nCompany: ${job.company ?? 'N/A'}\n\n` +
    `JOB DESCRIPTION:\n${desc}\n\n` +
    `SIGNALS (from our scorer — guidance, not facts to claim):\n` +
    `- Job keywords: ${signals.keywords || 'N/A'}\n` +
    `- Candidate skills this job mentions (lead with these): ${matched.length ? matched.join(', ') : 'N/A'}\n` +
    `- Candidate skills not mentioned by the job: ${unmatched.length ? unmatched.join(', ') : 'N/A'}\n` +
    `- Requirements the candidate may be missing (do NOT fake these; emphasize closest real strengths): ${signals.missing || 'N/A'}`;
  return [
    { role: 'system', content: TAILOR_PROMPT },
    { role: 'user', content: user },
  ];
}

/** Lowercased set of every skill keyword present in the base résumé (the truth boundary for skills). */
function baseSkillSet(base: ResumeDoc): Set<string> {
  const set = new Set<string>();
  for (const g of base.skills) for (const k of g.keywords) set.add(k.toLowerCase());
  return set;
}

/**
 * Merge the model's tailored draft onto the base résumé so only safe, reframed
 * content survives. Factual fields come from `base`; the model may only change
 * wording (summary, label, highlights) and ordering. Invented skills are dropped.
 * Pure — no I/O. Never throws.
 */
export function mergeTailored(base: ResumeDoc, tailored: ResumeDoc): ResumeDoc {
  // basics: keep identity from base; accept only reworded summary + label.
  const basics = {
    ...base.basics,
    summary: tailored.basics.summary?.trim() || base.basics.summary,
    label: tailored.basics.label?.trim() || base.basics.label,
  };

  // work: align by index; keep all factual fields, take rephrased highlights only.
  const work: ResumeWork[] = base.work.map((b, i) => {
    const t = tailored.work[i];
    const highlights = t && t.highlights.length ? t.highlights : b.highlights;
    return { ...b, highlights };
  });

  // skills: allow re-grouping/re-ordering, but DROP any keyword not in the base set.
  const allowed = baseSkillSet(base);
  let skills: ResumeSkill[] = tailored.skills
    .map((g) => ({ name: g.name, keywords: g.keywords.filter((k) => allowed.has(k.toLowerCase())) }))
    .filter((g) => g.keywords.length > 0);
  // If the model returned no real (base-backed) skills, fall back to the base unchanged.
  if (skills.length === 0) skills = base.skills;

  // projects: align by index; keep factual fields, take rephrased highlights.
  const projects: ResumeProject[] = base.projects.map((b, i) => {
    const t = tailored.projects[i];
    return { ...b, highlights: t && t.highlights.length ? t.highlights : b.highlights };
  });

  // education: never tailored — copy verbatim.
  return { basics, work, education: base.education, skills, projects };
}

/**
 * Produce a tailored résumé for a job. One LLM call (low temperature). The result
 * is normalized then merged onto the base so it can only ever contain truthful,
 * reframed content. Throws on empty base, an unparseable reply, or an LLM error —
 * the caller marks the application 'failed' rather than persisting a fabrication.
 */
export async function tailorResume(
  base: ResumeDoc,
  job: TailorJob,
  signals: TailorSignals,
  client?: LLMClient,
): Promise<ResumeDoc> {
  if (!base || base.work.length === 0) {
    throw new Error('Base résumé is empty — build it under Applications → Base résumé first.');
  }
  const llm = client ?? getClient();
  const response = await llm.chat(buildTailorMessages(base, job, signals), { maxTokens: 4000, temperature: 0.2 });
  const json = extractJsonObject(response);
  if (json == null) throw new Error('Could not parse a tailored résumé from the model response.');
  return mergeTailored(base, normalizeResume(json));
}
