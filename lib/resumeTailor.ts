/**
 * Per-job résumé tailoring (ADR 0024 → loosened in ADR 0026). ONE LLM call that
 * rewrites the user's résumé to win interviews for a specific job and pass ATS
 * keyword screening.
 *
 * This is the user's OWN résumé and they opt in (with a review/confirm step), so
 * tailoring is allowed to ENHANCE — add adjacent / quick-to-learn skills the job
 * wants, expand real experience in depth, and invent plausible supporting points.
 * The line we DO hold (verifiable identity facts that a background check would
 * catch): employer names, job titles, employment dates, and education are anchored
 * to the base résumé — `mergeTailored` restores them even if the model changed them.
 *
 * Everything the AI adds beyond the base (new skills + its self-reported invented
 * points) is returned as `changes` so the UI can show it for confirmation before
 * the résumé is used.
 */
import { getClient, LLMClient, ChatMessage } from './llm';
import { normalizeResume, extractJsonObject } from './resume';
import type { ResumeDoc, ResumeWork, ResumeProject, TailorChanges } from './types';

/** Scoring-v2 signals we already store, fed to the tailorer so it targets the right keywords. */
export interface TailorSignals {
  /** Must-haves the job wants that the candidate may lack — candidates for plausible additions. */
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

/** Tailored résumé + the disclosure of what was added/embellished. */
export interface TailorResult {
  resume: ResumeDoc;
  changes: TailorChanges;
}

export const TAILOR_PROMPT = `You are an expert résumé writer helping the candidate LAND INTERVIEWS for a specific job, and optimizing the résumé to pass ATS keyword screening (aim for a strong keyword match with the posting).

You may ENHANCE the résumé, not merely reword it. You ARE allowed to:
- Rewrite bullet points to foreground the job's requirements and keywords, adding plausible detail, metrics, and scenarios consistent with the candidate's real roles (e.g., if they touched WebSockets, describe real-time features in depth).
- ADD skills the job wants when the candidate could CREDIBLY have them or learn them in under ~15 days given their background, or that are closely ADJACENT to skills they already list. Weave those skills into the bullets too.
- Reorder/regroup skills and reframe the summary to match the role.

LENGTH — keep it to ONE PAGE; the tailored résumé must be NET-NEUTRAL in length (same as the base or shorter):
- Do NOT increase the number of bullet points (highlights) in ANY role or project. Each must have the SAME count as the base résumé, or fewer — NEVER more.
- You cannot just append a new point. To surface a job-relevant point, REPLACE or MERGE the LEAST important existing bullet in that role, or modify an existing bullet to carry the new emphasis. Adding one means removing/condensing one.
- Keep individual bullets to roughly one line; tighten wordy ones instead of growing the résumé.
- Skills are compact — you MAY still add skills (they don't push it to a second page).

HARD LIMITS — never change these verifiable facts (a background check would catch them):
- Employer / company names, job titles, and employment dates: keep EXACTLY as the base résumé.
- Education: institutions, degrees, and dates: keep EXACTLY. Do not invent new jobs, employers, or degrees.

STAY PLAUSIBLE: only add skills/claims a person with THIS candidate's background and seniority could believably have or quickly acquire. No wildly unrelated skills, no absurd seniority — it must hold up in an interview.

DISCLOSURE — also report what you changed: include a top-level "_changes" array of short strings listing (a) every skill you ADDED that wasn't in the base résumé, and (b) any notable points/scenarios you INVENTED or significantly embellished. Be honest and specific here.

Output ONLY a JSON object (no markdown/commentary), the SAME shape as the base résumé PLUS "_changes":
{
  "basics": { "name":"", "label":"", "email":"", "phone":"", "url":"", "location":"", "summary":"", "profiles":[{"network":"","url":""}] },
  "work": [ { "name":"", "position":"", "location":"", "startDate":"", "endDate":"", "highlights":["",""] } ],
  "education": [ { "institution":"", "area":"", "studyType":"", "startDate":"", "endDate":"", "score":"" } ],
  "skills": [ { "name":"", "keywords":["",""] } ],
  "projects": [ { "name":"", "description":"", "url":"", "highlights":[] } ],
  "_changes": ["Added Kubernetes (adjacent to your Docker/CI experience)", "Replaced a generic bullet with a detailed WebSockets real-time-collaboration one"]
}
Keep work entries in the same order and count, with the same companies, titles, and dates as the base résumé, and the SAME number of highlights per role/project as the base (or fewer) — never more.`;

export function buildTailorMessages(base: ResumeDoc, job: TailorJob, signals: TailorSignals): ChatMessage[] {
  const desc = (job.full_description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 12000);
  const matched = (signals.matched ?? []).filter(Boolean);
  const unmatched = (signals.unmatched ?? []).filter(Boolean);
  const user =
    `BASE RÉSUMÉ (the candidate's real experience — anchor employers/titles/dates/education to this — JSON):\n${JSON.stringify(base)}\n\n` +
    `TARGET JOB:\nTitle: ${job.title ?? 'N/A'}\nCompany: ${job.company ?? 'N/A'}\n\n` +
    `JOB DESCRIPTION:\n${desc}\n\n` +
    `SIGNALS (from our scorer):\n` +
    `- Job keywords: ${signals.keywords || 'N/A'}\n` +
    `- Candidate skills this job mentions (lead with these): ${matched.length ? matched.join(', ') : 'N/A'}\n` +
    `- Candidate skills not mentioned by the job: ${unmatched.length ? unmatched.join(', ') : 'N/A'}\n` +
    `- Requirements the job wants that the candidate may lack — ADD the plausible/quick-to-learn ones: ${signals.missing || 'N/A'}`;
  return [
    { role: 'system', content: TAILOR_PROMPT },
    { role: 'user', content: user },
  ];
}

/**
 * Length-neutral highlight merge (ADR 0029): take the model's (possibly reworded)
 * bullets but never MORE than the base had, so the résumé can't overflow one page.
 * Empty/omitted → keep base. A base with 0 highlights imposes no cap.
 */
function capHighlights(baseHl: string[], tailoredHl?: string[]): string[] {
  if (!tailoredHl || tailoredHl.length === 0) return baseHl;
  return baseHl.length > 0 ? tailoredHl.slice(0, baseHl.length) : tailoredHl;
}

/** Lowercased set of every skill keyword in a résumé. */
function skillSet(doc: ResumeDoc): Set<string> {
  const set = new Set<string>();
  for (const g of doc.skills) for (const k of g.keywords) set.add(k.toLowerCase());
  return set;
}

/**
 * Merge the model's draft onto the base, anchoring verifiable facts while keeping
 * the AI's enhancements (ADR 0026). Employers, titles, dates, and education come
 * from the BASE (the model can't change where you worked or your degree). Summary,
 * bullets, and the SKILL SET may be enhanced. Pure — never throws.
 */
export function mergeTailored(base: ResumeDoc, tailored: ResumeDoc): ResumeDoc {
  // basics: keep identity (name/email/phone/url/location/profiles); take reworded summary + label.
  const basics = {
    ...base.basics,
    summary: tailored.basics.summary?.trim() || base.basics.summary,
    label: tailored.basics.label?.trim() || base.basics.label,
  };

  // work: anchor company/title/dates/location to base; take the (possibly enhanced)
  // bullets but CAP their count to the base (length-neutral, ADR 0029) so tailoring
  // can't push the résumé onto a second page. The model is told to keep ≤ base count
  // ordered by importance, so trimming overflow only drops its least-important bullet.
  const work: ResumeWork[] = base.work.map((b, i) => ({ ...b, highlights: capHighlights(b.highlights, tailored.work[i]?.highlights) }));

  // skills: keep the model's groups AS-IS (additions allowed); fall back to base if empty.
  let skills = tailored.skills.filter((g) => g.keywords.length > 0);
  if (skills.length === 0) skills = base.skills;

  // projects: anchor name/url to base; take enhanced (count-capped) highlights.
  const projects: ResumeProject[] = base.projects.map((b, i) => ({ ...b, highlights: capHighlights(b.highlights, tailored.projects[i]?.highlights) }));

  // education: verifiable — copy verbatim from base.
  return { basics, work, education: base.education, skills, projects };
}

/** Skills present in the merged résumé that weren't in the base (what the AI added). */
export function addedSkills(base: ResumeDoc, merged: ResumeDoc): string[] {
  const had = skillSet(base);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const g of merged.skills) {
    for (const k of g.keywords) {
      const lk = k.toLowerCase();
      if (!had.has(lk) && !seen.has(lk)) {
        seen.add(lk);
        out.push(k);
      }
    }
  }
  return out;
}

/** Pull the model's self-reported "_changes" notes out of the raw JSON. */
function extractChangeNotes(json: unknown): string[] {
  if (json && typeof json === 'object' && Array.isArray((json as { _changes?: unknown })._changes)) {
    return ((json as { _changes: unknown[] })._changes)
      .filter((x): x is string => typeof x === 'string')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

/**
 * Produce a tailored résumé for a job (ADR 0026). One LLM call. Returns the merged
 * résumé plus `changes` (added skills + the model's invented-point notes) so the UI
 * can show it for review/confirmation. Throws on empty base / unparseable reply.
 */
export async function tailorResume(
  base: ResumeDoc,
  job: TailorJob,
  signals: TailorSignals,
  client?: LLMClient,
): Promise<TailorResult> {
  if (!base || base.work.length === 0) {
    throw new Error('Base résumé is empty — build it under Applications → Base résumé first.');
  }
  const llm = client ?? getClient();
  const response = await llm.chat(buildTailorMessages(base, job, signals), { maxTokens: 4000, temperature: 0.35 });
  const json = extractJsonObject(response);
  if (json == null) throw new Error('Could not parse a tailored résumé from the model response.');
  const notes = extractChangeNotes(json);
  const resume = mergeTailored(base, normalizeResume(json));
  return { resume, changes: { addedSkills: addedSkills(base, resume), notes } };
}
