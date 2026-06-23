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
- Rewrite bullet points to foreground the job's requirements and keywords, adding plausible detail and metrics consistent with the candidate's real roles.
- ADD skills the job wants when the candidate could CREDIBLY have them or learn them in under ~15 days given their background, or that are closely ADJACENT to skills they already list. Weave those skills into the bullets too.
- Reorder/regroup skills and reframe the summary to match the role.

LENGTH IS A HARD CONSTRAINT — the résumé MUST fit ONE page. The user message carries a LENGTH BUDGET computed from the base résumé; your output MUST stay within it:
- Each role/project gets AT MOST the number of bullets the budget lists — match it or go UNDER, NEVER over. To surface a new point, REPLACE or MERGE the least-important existing bullet; never append a bullet.
- Keep EVERY bullet to ONE line (~120 characters). A bullet that wraps to a second line costs as much vertical space as two — tighten wordy bullets instead of letting them grow.
- Keep the summary within its character budget (2–3 lines).
- Stay within the SKILLS budget. Adding a few job-relevant skills is good, but a long skills list ALSO overflows the page — drop weaker skills to make room for the ones this job wants.

HARD LIMITS — these verifiable facts (a background check would catch them) are restored from the base no matter what you send, so DON'T spend output tokens on them: employer/company names, job titles, employment dates, locations, contact details, and ALL of education. OMIT them entirely.

STAY PLAUSIBLE: only add skills/claims a person with THIS candidate's background and seniority could believably have or quickly acquire. No wildly unrelated skills, no absurd seniority — it must hold up in an interview.

DISCLOSURE — include a top-level "_changes" array of short strings listing (a) every skill you ADDED that wasn't in the base résumé, and (b) any notable points/scenarios you INVENTED or significantly embellished. Be honest and specific here.

Output ONLY a JSON object (no markdown/commentary) with ONLY these fields. Keep "work" and "projects" in the SAME ORDER and SAME COUNT as the base (one entry per role/project), with "name" copied from the base purely so the bullets stay aligned to the right role:
{
  "basics": { "summary": "", "label": "" },
  "work": [ { "name": "<company, copied from base>", "highlights": ["", ""] } ],
  "skills": [ { "name": "", "keywords": ["", ""] } ],
  "projects": [ { "name": "<project name, copied from base>", "highlights": [] } ],
  "_changes": ["Added Kubernetes (adjacent to your Docker/CI experience)", "Tightened a generic bullet into a detailed WebSockets real-time-collaboration one"]
}
Do NOT output name, contact, profiles, job titles, dates, locations, or education — they are filled from the base. Never output more highlights for a role/project than its budget allows.`;

/** Per-section length budget derived from the base résumé (which already fits one page).
 *  Injected into the prompt so the model aims for the right size, and mirrored by the
 *  deterministic caps in `mergeTailored` so the page can't overflow if it doesn't (ADR 0031). */
function lengthBudget(base: ResumeDoc): string {
  const summary = summaryBudget(base);
  const work = base.work.map((w, i) => `  - ${w.name || `role ${i + 1}`}: ${w.highlights.length} bullet(s) max`).join('\n');
  const projects = base.projects.map((p, i) => `  - ${p.name || `project ${i + 1}`}: ${p.highlights.length} bullet(s) max`).join('\n');
  return (
    `Summary: ≤ ${summary} characters.\n` +
    `Work bullets per role (match or go under, NEVER over):\n${work || '  (none)'}\n` +
    `Project bullets per project:\n${projects || '  (none)'}\n` +
    `Total skill keywords across all groups: ≤ ${skillBudget(base)}.`
  );
}

export function buildTailorMessages(base: ResumeDoc, job: TailorJob, signals: TailorSignals): ChatMessage[] {
  const desc = (job.full_description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 12000);
  const matched = (signals.matched ?? []).filter(Boolean);
  const unmatched = (signals.unmatched ?? []).filter(Boolean);
  // STABLE prefix (system prompt + this block) — cached across every job the user
  // tailors in a session. The budget is derived only from the base, so it's stable too.
  const baseBlock =
    `BASE RÉSUMÉ (the candidate's real experience — anchor employers/titles/dates/education to this — JSON):\n${JSON.stringify(base)}\n\n` +
    `LENGTH BUDGET (derived from the base — your output MUST stay within these so it fits one page):\n${lengthBudget(base)}`;
  // VOLATILE tail — the per-job content, after the cache breakpoint.
  const jobBlock =
    `TARGET JOB:\nTitle: ${job.title ?? 'N/A'}\nCompany: ${job.company ?? 'N/A'}\n\n` +
    `JOB DESCRIPTION:\n${desc}\n\n` +
    `SIGNALS (from our scorer):\n` +
    `- Job keywords: ${signals.keywords || 'N/A'}\n` +
    `- Candidate skills this job mentions (lead with these): ${matched.length ? matched.join(', ') : 'N/A'}\n` +
    `- Candidate skills not mentioned by the job: ${unmatched.length ? unmatched.join(', ') : 'N/A'}\n` +
    `- Requirements the job wants that the candidate may lack — ADD the plausible/quick-to-learn ones: ${signals.missing || 'N/A'}`;
  return [
    { role: 'system', content: TAILOR_PROMPT },
    { role: 'user', content: [{ text: baseBlock, cache: true }, { text: jobBlock }] },
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

/** Character budget for the summary: base length + 15% slack, floor 320 (ADR 0031). */
function summaryBudget(base: ResumeDoc): number {
  return Math.max(Math.ceil((base.basics.summary || '').length * 1.15), 320);
}

/** Total-keyword budget across all skill groups: base count + slack (ADR 0031). */
function skillBudget(base: ResumeDoc): number {
  const baseCount = base.skills.reduce((n, g) => n + g.keywords.length, 0);
  return Math.max(baseCount + 6, Math.ceil(baseCount * 1.4));
}

/** Take the model's summary but hard-cap it to the budget, trimmed at a word boundary. */
function capSummary(base: ResumeDoc, tailored?: string): string | undefined {
  const t = (tailored || '').trim();
  if (!t) return base.basics.summary;
  const budget = summaryBudget(base);
  if (t.length <= budget) return t;
  const cut = t.slice(0, budget);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > budget * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.]+$/, '').trim();
}

/** Keep the model's skill groups in order but cap total keywords to the budget (ADR 0031). */
function capSkills(base: ResumeDoc, tailored: ResumeDoc['skills']): ResumeDoc['skills'] {
  const budget = skillBudget(base);
  const out: ResumeDoc['skills'] = [];
  let used = 0;
  for (const g of tailored) {
    if (used >= budget) break;
    const keywords = g.keywords.slice(0, budget - used);
    if (keywords.length) {
      out.push({ name: g.name, keywords });
      used += keywords.length;
    }
  }
  return out;
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
  // basics: keep identity (name/email/phone/url/location/profiles); take the reworded
  // summary + label, but hard-cap the summary length (ADR 0031) so a verbose summary
  // can't push the résumé onto a second page.
  const basics = {
    ...base.basics,
    summary: capSummary(base, tailored.basics.summary),
    label: tailored.basics.label?.trim() || base.basics.label,
  };

  // work: anchor company/title/dates/location to base; take the (possibly enhanced)
  // bullets but CAP their count to the base (length-neutral, ADR 0029) so tailoring
  // can't push the résumé onto a second page. The model is told to keep ≤ base count
  // ordered by importance, so trimming overflow only drops its least-important bullet.
  const work: ResumeWork[] = base.work.map((b, i) => ({ ...b, highlights: capHighlights(b.highlights, tailored.work[i]?.highlights) }));

  // skills: keep the model's groups (additions allowed) but CAP the total keyword count
  // (ADR 0031) — a long skills list also overflows the page; fall back to base if empty.
  const tailoredSkills = tailored.skills.filter((g) => g.keywords.length > 0);
  const skills = tailoredSkills.length > 0 ? capSkills(base, tailoredSkills) : base.skills;

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
