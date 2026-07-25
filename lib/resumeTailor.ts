/**
 * Per-job résumé tailoring (ADR 0024 → loosened in ADR 0026). ONE LLM call that
 * rewrites the user's résumé to win interviews for a specific job and pass ATS
 * keyword screening.
 *
 * This is the user's OWN résumé and they opt in (with a review/confirm step), so
 * tailoring is allowed to ENHANCE — add adjacent / quick-to-learn skills the job
 * wants, expand real experience in depth, and invent plausible supporting points.
 * The line we DO hold (verifiable identity facts that a background check would
 * catch): employer names, employment dates, and education are anchored to the base
 * résumé — `mergeTailored` restores them even if the model changed them. Job TITLES
 * may be honestly reframed toward the target role (ADR 0055); every change is
 * detected deterministically and disclosed for review.
 *
 * Everything the AI adds beyond the base (new skills + its self-reported invented
 * points) is returned as `changes` so the UI can show it for confirmation before
 * the résumé is used.
 */
import { getClient, LLMClient, ChatMessage } from './llm';
import { normalizeResume, extractJsonObject } from './resume';
import { DEFAULT_TAILORING_POLICY, type TailoringPolicy } from './candidatePreferences';
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
  /** Exact posting-form terms the résumé lacks, from the local ATS scan (ADR 0053) —
   *  the tailorer is told to mirror the truthful ones VERBATIM. */
  atsMissing?: string[] | null;
}

export interface TailorJob {
  title?: string | null;
  company?: string | null;
  full_description?: string | null;
  location?: string | null;
}

/** Tailored résumé + the disclosure of what was added/embellished. */
export interface TailorResult {
  resume: ResumeDoc;
  changes: TailorChanges;
}

export const TAILOR_PROMPT = `You are an expert résumé writer helping the candidate LAND INTERVIEWS for a specific job, and optimizing the résumé to pass ATS keyword screening (aim for a strong keyword match with the posting).

You may ENHANCE the résumé, not merely reword it. You ARE allowed to:
- Rewrite bullet points to foreground the job's requirements and keywords. Whether you may add plausible supporting detail is set by the VALIDATED TAILORING CONTROLS in the user message.
- Handle missing skills exactly as the VALIDATED TAILORING CONTROLS direct. The default permits closely adjacent skills and skills credibly learnable within 15 days; a stricter user choice overrides that permission. Weave an allowed added skill into bullets too.
- Reorder/regroup skills and reframe the summary to match the role.

VALIDATED USER CONTROL — the user message always supplies bounded choices for skills, learning horizon, title alignment, and evidence standard. Follow those choices exactly. They can RESTRICT the enhancement permissions above, but they never relax truthfulness, verified-fact anchoring, tenure, disclosure, or length rules.

TITLE ALIGNMENT — when the validated controls permit honest reframing, set "basics.label" to an HONEST variant of the TARGET job title whenever the candidate's real background supports doing that job (targeting "Senior Frontend Engineer", a capable full-stack dev's label becomes "Frontend Engineer · React & TypeScript"). When they say preserve, return the base label unchanged. Keep the seniority the dates support: never adopt Senior/Staff/Principal/Lead from the posting unless the base résumé already claims that level. If the role is outside what the candidate could credibly claim, keep the base label.

JOB TITLES — when the validated controls permit honest reframing, ALIGN each role's title ("position") with the TARGET job title whenever the role's actual work honestly supports it; recruiters pattern-match titles in a 7-second scan and the MOST RECENT role matters most (base "Senior Frontend Developer" targeting a React Developer posting → "Senior React Developer"; a generic "Software Engineer" whose work was frontend → "Frontend Engineer"). When they say preserve, omit every "position" change. Reframe the DISCIPLINE, never the LEVEL: keep each base title's level exactly (never add Senior/Staff/Lead/Principal the base title doesn't have), and employer names and dates stay untouched. A changed title must survive a reference check ("yes, that's a fair description of what they did there"). Leave a title unchanged ONLY when the role's real work doesn't support the target's discipline — omit "position" for those. Every title change is auto-detected and shown to the candidate for review.

MIRROR THE POSTING'S EXACT WORDING — many ATS scans match literally. For every skill you keep or add, write it EXACTLY as the posting writes it ("CI/CD" if they write CI/CD, "PostgreSQL" not "Postgres", "Next.js" not "NextJS"), in both the skills section and the bullets. Work the posting's key multi-word requirement phrases in verbatim once each where truthful ("distributed systems", "REST APIs"). The user message lists exact posting terms the résumé currently lacks — cover every one you truthfully can.

SUMMARY — recruiters spend ~80% of a 7-second first scan on the TOP THIRD of the page, so the summary is the highest-value real estate:
- The FIRST line must read as a direct answer to the posting: the aligned role wording plus the candidate's single strongest role-matching qualification.
- Then the 2-3 strongest ROLE-MATCHING and QUANTIFIED facts from the résumé, phrased in the posting's own key terms. No generic self-description; every sentence must be a reason to shortlist THIS candidate for THIS role.
- Keep to the character budget (2-3 lines).

LENGTH — the résumé must fit ONE page AND fill it; a sparse, half-empty page with thin one-line bullets looks weak. The user message carries a LENGTH BUDGET computed from the base résumé:
- Keep the SAME number of bullets per role/project/custom-section entry as the budget lists, or fewer, NEVER more. To surface a new point, REWRITE or MERGE an existing bullet; never append one.
- ORDER each role's bullets by relevance to THIS job and VARY their length so the page reads human-written: open with the strongest, most role-relevant bullet at a FULL two lines (roughly 210-260 characters). For the rest, MIX lengths deliberately — some tight one-liners (roughly 110-140 characters), some full two-liners (roughly 200-260) — and never let consecutive bullets land within ~20 characters of each other. These numbers are guidance for VARIETY, not targets to hit: clustering most bullets near one length (e.g. everything at ~180-200 characters, about 1.25 rendered lines) is an instant AI tell. Every bullet still needs real substance: the scope or context, the action and concrete technologies, and a quantified result. Do NOT pad with filler; thin fragments and uniform same-length bullets both look templated.
- Stay within the SKILLS budget; drop weaker, generic skills to make room for the ones this job wants.

HARD LIMITS — these verifiable facts (a background check would catch them) are restored from the base no matter what you send, so DON'T spend output tokens on them: employer/company names, employment dates, locations, contact details, ALL of education, and custom-section titles/item names/descriptions/dates/locations/links. OMIT them entirely. (Work job titles are the one exception — see JOB TITLES above.)

STAY PLAUSIBLE: only add skills/claims a person with THIS candidate's background and seniority could believably have or quickly acquire. No wildly unrelated skills, no absurd seniority; it must hold up in an interview.

NEVER INFLATE TENURE — total years of experience is a VERIFIABLE FACT that falls out of the employment dates, not a number you may round up to match the posting. The user message states the candidate's TRUE total years of professional experience. Do not claim, imply, or state a HIGHER figure anywhere (summary, label, or bullets); if you mention years of experience, use that number or fewer, and never assign a seniority the dates don't support.

WRITE LIKE A HUMAN, NOT AN AI — recruiters and reviewers spot AI-written résumés instantly and it hurts the candidate:
- Start every bullet with a strong, VARIED past-tense action verb (Architected, Built, Led, Migrated, Shipped, Designed, Cut, Scaled, Automated, Rebuilt). Do not reuse the same opener across bullets.
- Be concrete and quantified: name the real system, the technology, the scale, and a measurable result. Never write vague filler like "responsible for", "worked on", or "helped with".
- NEVER use an em-dash (—). Use a comma, "and", or a period instead.
- Do NOT use these AI-tell / filler words: leverage, utilize, robust, seamless, spearhead, synergy, facilitate, foster, elevate, navigate, landscape, tapestry, realm, cutting-edge, state-of-the-art, "passionate about", "results-driven", "team player", and the "not just X, but Y" construction. Say it plainly: use (not utilize), built (not spearheaded), improve (not elevate).
- Vary sentence structure and rhythm across bullets; do not make every bullet the same shape.

DISCLOSURE — include a top-level "_changes" array. Keep it SHORT (token budget): the FIRST entry is ONE sentence (≤ 200 chars) summarizing what you changed and why this candidate is a good fit for the role. Then add one short entry ONLY for each point/scenario you genuinely INVENTED or significantly embellished (something a background check or interview could expose) — omit routine rewording, reordering, and added skills (those are detected automatically). If you invented nothing, return just the single summary sentence.

Output ONLY a JSON object (no markdown/commentary) with ONLY these fields. Keep "work", "projects", and "customSections" in the SAME ORDER and SAME COUNT as the base, and keep every custom section's "items" in the same order/count. Copy alignment names/titles from the base purely so the bullets stay attached to the right entry:
{
  "basics": { "summary": "", "label": "" },
  "work": [ { "name": "<company, copied from base>", "position": "<job title — ONLY when honestly adjusted, else omit>", "highlights": ["", ""] } ],
  "skills": [ { "name": "", "keywords": ["", ""] } ],
  "projects": [ { "name": "<project name, copied from base>", "highlights": [] } ],
  "customSections": [ { "title": "<section title, copied from base>", "items": [ { "name": "<item name, copied from base>", "highlights": [] } ] } ],
  "_changes": ["Reframed your summary and bullets around the role's cloud/CI focus and added Kubernetes — a strong fit given your Docker experience.", "Embellished: described leading a 5-engineer migration (you contributed but did not lead it)"]
}
Do NOT output identity, contact, profiles, dates, locations, education, or custom-section factual fields — they are filled from the base. Never output more highlights for any entry than its budget allows.`;

/** Per-section length budget derived from the base résumé (which already fits one page).
 *  Injected into the prompt so the model aims for the right size, and mirrored by the
 *  deterministic caps in `mergeTailored` so the page can't overflow if it doesn't (ADR 0031). */
function lengthBudget(base: ResumeDoc): string {
  const summary = summaryBudget(base);
  const work = base.work.map((w, i) => `  - ${w.name || `role ${i + 1}`}: ${w.highlights.length} bullet(s) max`).join('\n');
  const projects = base.projects.map((p, i) => `  - ${p.name || `project ${i + 1}`}: ${p.highlights.length} bullet(s) max`).join('\n');
  const custom = (base.customSections ?? [])
    .flatMap((section, sectionIndex) =>
      section.items.map(
        (item, itemIndex) =>
          `  - ${section.title || `custom section ${sectionIndex + 1}`} / ${item.name || `entry ${itemIndex + 1}`}: ${item.highlights.length} bullet(s) max`,
      ),
    )
    .join('\n');
  return (
    `Summary: ≤ ${summary} characters.\n` +
    `Work bullets per role (match or go under, NEVER over):\n${work || '  (none)'}\n` +
    `Project bullets per project:\n${projects || '  (none)'}\n` +
    `Custom-section bullets per entry:\n${custom || '  (none)'}\n` +
    `Total skill keywords across all groups: ≤ ${skillBudget(base)}.`
  );
}

export function buildTailorMessages(base: ResumeDoc, job: TailorJob, signals: TailorSignals, instructions = ''): ChatMessage[] {
  const desc = (job.full_description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 12000);
  const matched = (signals.matched ?? []).filter(Boolean);
  const unmatched = (signals.unmatched ?? []).filter(Boolean);
  const atsMissing = (signals.atsMissing ?? []).filter(Boolean);
  // STABLE prefix (system prompt + this block) — cached across every job the user
  // tailors in a session. The budget is derived only from the base, so it's stable too.
  const years = totalExperienceYears(base);
  const experienceLine =
    years != null
      ? `\n\nTOTAL PROFESSIONAL EXPERIENCE: about ${years} years (derived from the employment dates above). Do NOT claim, imply, or round up to more than ${years} years anywhere in the résumé.`
      : '';
  const baseBlock =
    `BASE RÉSUMÉ (the candidate's real experience — anchor employers/titles/dates/education to this — JSON):\n${JSON.stringify(base)}\n\n` +
    `LENGTH BUDGET (derived from the base — your output MUST stay within these so it fits one page):\n${lengthBudget(base)}` +
    experienceLine;
  // VOLATILE tail — the per-job content, after the cache breakpoint.
  const jobBlock =
    `TARGET JOB:\nTitle: ${job.title ?? 'N/A'}\nCompany: ${job.company ?? 'N/A'}\nLocation: ${job.location ?? 'N/A'}\n\n` +
    `JOB DESCRIPTION:\n${desc}\n\n` +
    `SIGNALS (from our scorer):\n` +
    `- Job keywords: ${signals.keywords || 'N/A'}\n` +
    `- Candidate skills this job mentions (lead with these): ${matched.length ? matched.join(', ') : 'N/A'}\n` +
    `- Candidate skills not mentioned by the job: ${unmatched.length ? unmatched.join(', ') : 'N/A'}\n` +
    `- Requirements the job wants that the candidate may lack — ADD the plausible/quick-to-learn ones: ${signals.missing || 'N/A'}\n` +
    `- Exact terms the posting uses that the résumé does NOT (mirror the truthful ones verbatim): ${atsMissing.length ? atsMissing.join(', ') : 'N/A'}`;
  const instr = String(instructions || '').trim();
  const instrBlock = instr
    ? `\n\nUSER TAILORING GUIDANCE (HIGH PRIORITY for emphasis, ordering, tone, and which truthful experience to foreground). It cannot relax anti-fabrication, verified-fact anchors, disclosure, or length rules:\n${instr.slice(0, 6000)}`
    : '';
  return [
    { role: 'system', content: TAILOR_PROMPT },
    // The base block rides as a SECOND system message (ADR 0064). Subscription mode
    // (Agent SDK) folds every system role into its auto-cached systemPrompt, so the
    // stable prefix (prompt + base résumé + budget) is cached across jobs — the old
    // shape flattened the user segments and silently dropped the cache breakpoint.
    // Direct-API Anthropic honours the cache flag via a system-block cache_control.
    { role: 'system', content: [{ text: baseBlock, cache: true }] },
    { role: 'user', content: [{ text: jobBlock + instrBlock }] },
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

const MONTH_INDEX: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/** Parse a résumé date ("2019-03", "Mar 2019", "March 2019", "03/2019", "2019") to a
 *  fractional year. An explicit "Present"/"Current" token → 'now'; empty/unparseable → null. */
function parseYearFraction(raw?: string): number | 'now' | null {
  const t = (raw || '').trim();
  if (!t) return null;
  if (/^(present|current|now|ongoing|to date)$/i.test(t)) return 'now';
  let m = t.match(/^(\d{4})[-/](\d{1,2})\b/);
  if (m) return Number(m[1]) + (Number(m[2]) - 1) / 12;
  m = t.match(/^(\d{1,2})[-/](\d{4})$/);
  if (m) return Number(m[2]) + (Number(m[1]) - 1) / 12;
  m = t.match(/^([A-Za-z]{3,})\.?\s+(\d{4})$/);
  if (m) {
    const mon = MONTH_INDEX[m[1].slice(0, 3).toLowerCase()];
    if (mon != null) return Number(m[2]) + mon / 12;
  }
  m = t.match(/\b(\d{4})\b/);
  if (m) return Number(m[1]);
  return null;
}

/**
 * The candidate's TRUE total years of professional experience, derived from the base
 * résumé's employment dates: earliest start → latest end (an open/Present role counts to
 * `now`), floored to a whole year. This is the most generous DEFENSIBLE figure, so it
 * doubles as the ceiling the tailorer may not exceed. Returns null if no date parses.
 */
export function totalExperienceYears(base: ResumeDoc, now: Date = new Date()): number | null {
  const nowFrac = now.getFullYear() + now.getMonth() / 12;
  let earliest: number | null = null;
  let latest: number | null = null;
  for (const w of base.work) {
    const start = parseYearFraction(w.startDate);
    if (typeof start === 'number') earliest = earliest == null ? start : Math.min(earliest, start);
    const end = parseYearFraction(w.endDate);
    // Open or unparseable end date on a role → treat as ongoing (Present), the résumé convention.
    const endFrac = end === 'now' || end == null ? nowFrac : end;
    latest = latest == null ? endFrac : Math.max(latest, endFrac);
  }
  if (earliest == null || latest == null) return null;
  return Math.max(0, Math.floor(latest - earliest));
}

/**
 * Deterministic anti-inflation guard (ADR 0041): clamp any "N years" / "N+ yrs" claim
 * that EXCEEDS the candidate's true career span down to that span. A no-op when the span
 * is unknown or the figure is already within range — so a truthful "5 years" is untouched
 * while a fabricated "8+ years" on a 6-year history becomes "6+ years".
 */
export function clampYoeClaims(text: string, maxYears: number | null): string {
  if (!text || maxYears == null) return text;
  return text.replace(/\b(\d{1,2})(\s*\+?\s*)(years?|yrs?)\b/gi, (full, num: string, mid: string, unit: string) =>
    Number(num) > maxYears ? `${maxYears}${mid}${unit}` : full,
  );
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
 * Strip the #1 AI tell from generated bullet/summary text: an em-dash used as
 * punctuation becomes a comma (ADR 0033). Hyphens in compound words (cross-browser,
 * real-time) and en-dashes in date ranges are left alone — only the em-dash (U+2014)
 * is targeted. Also tidies the spacing the substitution can leave behind.
 */
function cleanText(s: string): string {
  return s
    .replace(/\s*—\s*/g, ', ')
    .replace(/,\s*,/g, ',')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .trim();
}

/**
 * Merge the model's draft onto the base, anchoring verifiable facts while keeping
 * the AI's enhancements (ADR 0026). Employers, dates, and education come from the
 * BASE (the model can't change where you worked or your degree). Summary, bullets,
 * job titles (ADR 0055), and the SKILL SET may be enhanced. Pure — never throws.
 */
export function mergeTailored(
  base: ResumeDoc,
  tailored: ResumeDoc,
  policy: TailoringPolicy = DEFAULT_TAILORING_POLICY,
): ResumeDoc {
  // Years of experience is a verifiable fact derived from the dates (ADR 0041): clamp any
  // claim that exceeds the candidate's true career span so the model can't inflate tenure.
  const maxYears = totalExperienceYears(base);
  const finish = (s: string): string => cleanText(clampYoeClaims(s, maxYears));

  // basics: keep identity (name/email/phone/url/location/profiles); take the reworded
  // summary + label, but hard-cap the summary length (ADR 0031) so a verbose summary
  // can't push the résumé onto a second page.
  const cappedSummary = capSummary(base, tailored.basics.summary);
  const rawLabel = policy.titleAlignment === 'preserve'
    ? base.basics.label
    : tailored.basics.label?.trim() || base.basics.label;
  const basics = {
    ...base.basics,
    summary: cappedSummary ? finish(cappedSummary) : cappedSummary,
    label: rawLabel ? clampYoeClaims(rawLabel, maxYears) : rawLabel,
  };

  // work: anchor company/dates/location to base; take the (possibly enhanced)
  // bullets but CAP their count to the base (length-neutral, ADR 0029) so tailoring
  // can't push the résumé onto a second page. The model is told to keep ≤ base count
  // ordered by importance, so trimming overflow only drops its least-important bullet.
  // cleanText strips any em-dash AI tell from the generated bullets (ADR 0033).
  // The TITLE may be adjusted (ADR 0055): an honest discipline reframe aligned with the
  // target role — detected + disclosed via titleChanges(); empty/omitted keeps the base.
  const work: ResumeWork[] = base.work.map((b, i) => ({
    ...b,
    position: policy.titleAlignment === 'preserve'
      ? b.position
      : tailored.work[i]?.position?.trim() ? finish(tailored.work[i].position.trim()) : b.position,
    highlights: capHighlights(b.highlights, tailored.work[i]?.highlights).map(finish),
  }));

  // skills: keep the model's groups (additions allowed) but CAP the total keyword count
  // (ADR 0031) — a long skills list also overflows the page; fall back to base if empty.
  const tailoredSkills = tailored.skills.filter((g) => g.keywords.length > 0);
  const skills = policy.skillAdditionMode === 'evidenced_only'
    ? base.skills
    : tailoredSkills.length > 0 ? capSkills(base, tailoredSkills) : base.skills;

  // projects: anchor name/url to base; take enhanced (count-capped, em-dash-cleaned) highlights.
  const projects: ResumeProject[] = base.projects.map((b, i) => ({ ...b, highlights: capHighlights(b.highlights, tailored.projects[i]?.highlights).map(finish) }));

  // Custom headings and item metadata are user-authored facts. Keep them verbatim,
  // while allowing the AI to reframe only their existing bullets under the same
  // count cap as work/projects (ADR 0085).
  const customSections = (base.customSections ?? []).map((section, sectionIndex) => ({
    ...section,
    items: section.items.map((item, itemIndex) => ({
      ...item,
      highlights: capHighlights(
        item.highlights,
        tailored.customSections?.[sectionIndex]?.items[itemIndex]?.highlights,
      ).map(finish),
    })),
  }));

  // education: verifiable — copy verbatim from base.
  return { basics, work, education: base.education, skills, projects, customSections };
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

/** Human-readable "old → new" for every job title the tailorer adjusted (ADR 0055).
 *  Deterministic — compares merged vs base, never trusting the model's own disclosure. */
export function titleChanges(base: ResumeDoc, merged: ResumeDoc): string[] {
  const out: string[] = [];
  merged.work.forEach((w, i) => {
    const b = base.work[i];
    if (!b) return;
    const from = (b.position || '').trim();
    const to = (w.position || '').trim();
    if (to && to !== from) out.push(`${b.name || `Role ${i + 1}`}: "${from || '—'}" → "${to}"`);
  });
  return out;
}

/** The model-judged header location for this copy (ADR 0112), sanitized to a short
 *  single line. null (missing/junk) means: keep the base home location. */
function extractResumeLocation(json: unknown): string | null {
  const v = json && typeof json === 'object' ? (json as { resume_location?: unknown }).resume_location : null;
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, ' ').trim();
  return s && s.length <= 60 ? s : null;
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
  instructions = '',
  policy: TailoringPolicy = DEFAULT_TAILORING_POLICY,
): Promise<TailorResult> {
  if (!base || base.work.length === 0) {
    throw new Error('Base résumé is empty — build it under Candidate Profile → Résumé first.');
  }
  const llm = client ?? getClient();
  const response = await llm.chat(buildTailorMessages(base, job, signals, instructions), { maxTokens: 4000, temperature: 0.35 });
  const json = extractJsonObject(response);
  if (json == null) throw new Error('Could not parse a tailored résumé from the model response.');
  const notes = extractChangeNotes(json);
  const resume = mergeTailored(base, normalizeResume(json), policy);
  // Opt-in header location (ADR 0104), judged by the same call (ADR 0112): remote,
  // vague, and same-metro jobs come back as the home location; the raw job string is
  // never copied verbatim, and a missing/junk field keeps the base.
  if (policy.useJobLocation) {
    const headerLocation = extractResumeLocation(json);
    if (headerLocation) resume.basics.location = headerLocation;
  }
  return { resume, changes: { addedSkills: addedSkills(base, resume), titleChanges: titleChanges(base, resume), notes } };
}
