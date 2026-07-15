/**
 * One-time parse of the user's plain-text résumé into the structured JSON Resume
 * subset (ADR 0024, Phase 1). A SINGLE LLM call — bounded and serverless-safe, so
 * it runs in a Netlify route (unlike the PDF render, which needs the worker).
 *
 * Strictly a STRUCTURING step: the model reorganizes what's written into fields,
 * verbatim. It must NOT invent, embellish, or rewrite — the same anti-fabrication
 * discipline as the scorer. (Per-job tailoring later reframes the real bullets;
 * that is a separate call.) On any failure we throw — the caller surfaces the
 * error rather than persisting a fabricated résumé.
 */
import { getClient, LLMClient, ChatMessage } from './llm';
import { normalizeResume, extractJsonObject } from './resume';
import type { ResumeDoc } from './types';

export interface ParsedResumeSetup {
  resume: ResumeDoc;
  /** Only facts the uploaded résumé states explicitly; absent fields stay unknown. */
  workAuthorization: Record<string, unknown>;
}

export const RESUME_PARSE_PROMPT = `You convert a plain-text résumé into structured JSON. You are a PARSER, not a writer.

ABSOLUTE RULES:
- Extract ONLY what the résumé actually says. Copy wording verbatim (you may fix obvious typos/spacing, nothing more).
- NEVER invent, embellish, infer, or add skills, dates, titles, employers, metrics, or bullets that aren't present.
- If a field is absent, omit it or use an empty string — do not guess.
- Keep every real bullet point as its own highlight string.

Output ONLY a JSON object (no markdown, no commentary) with EXACTLY this shape:
{
  "basics": {
    "name": "", "label": "", "email": "", "phone": "", "url": "", "location": "City, State",
    "summary": "",
    "profiles": [{ "network": "LinkedIn", "url": "" }]
  },
  "work": [
    { "name": "Company", "position": "Title", "location": "", "startDate": "", "endDate": "", "highlights": ["bullet", "bullet"] }
  ],
  "education": [
    { "institution": "", "area": "", "studyType": "", "startDate": "", "endDate": "", "score": "" }
  ],
  "skills": [
    { "name": "Group e.g. Frontend", "keywords": ["React", "TypeScript"] }
  ],
  "projects": [
    { "name": "", "description": "", "url": "", "highlights": [] }
  ],
  "profile_work_authorization": {
    "legally_authorized_to_work": null,
    "require_sponsorship": null,
    "work_permit_type": "",
    "citizenship_or_residency": "",
    "security_clearance": ""
  }
}

"label" is the headline/title under the name if present (e.g. "Senior Frontend Engineer"). Use "Present" for a current role's endDate. Group skills the way the résumé groups them; if ungrouped, make sensible groups WITHOUT adding skills that aren't listed.

For profile_work_authorization, include a field ONLY when the résumé explicitly states it. Do not infer authorization, citizenship, residency, sponsorship needs, permit type, or clearance from a name, location, school, employer, or visa-adjacent wording. If the résumé says nothing about work authorization, output an empty object.`;

export function buildResumeParseMessages(resumeText: string): ChatMessage[] {
  const trimmed = (resumeText || '').slice(0, 15000);
  return [
    { role: 'system', content: RESUME_PARSE_PROMPT },
    { role: 'user', content: `RÉSUMÉ TEXT:\n${trimmed}` },
  ];
}

/**
 * Parse résumé text into a normalized ResumeDoc. One LLM call (temperature 0 for a
 * faithful, stable extraction). Throws on empty input, an unparseable response, or
 * any LLM error — never returns a fabricated résumé.
 */
function sanitizeWorkAuthorization(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of ['legally_authorized_to_work', 'require_sponsorship'] as const) {
    if (typeof source[key] === 'boolean') result[key] = source[key];
  }
  for (const key of ['work_permit_type', 'citizenship_or_residency', 'security_clearance'] as const) {
    if (typeof source[key] === 'string' && source[key].trim()) result[key] = source[key].trim().slice(0, 200);
  }
  return result;
}

/** Parse the résumé and any explicitly stated work-authorization facts in one AI call. */
export async function parseResumeSetup(resumeText: string, client?: LLMClient): Promise<ParsedResumeSetup> {
  if (!resumeText || !resumeText.trim()) {
    throw new Error('No résumé text to parse — add your résumé under Profile first.');
  }
  const llm = client ?? getClient();
  const response = await llm.chat(buildResumeParseMessages(resumeText), { maxTokens: 4000, temperature: 0 });
  const json = extractJsonObject(response);
  if (json == null) {
    throw new Error('Could not parse a résumé out of the model response.');
  }
  const raw = json && typeof json === 'object' && !Array.isArray(json)
    ? json as Record<string, unknown>
    : {};
  return {
    resume: normalizeResume(raw),
    workAuthorization: sanitizeWorkAuthorization(raw.profile_work_authorization),
  };
}

export async function parseResumeText(resumeText: string, client?: LLMClient): Promise<ResumeDoc> {
  return (await parseResumeSetup(resumeText, client)).resume;
}
