/**
 * Mail classifier (ADR 0012). A separate, cheap LLM call that sorts an incoming
 * email into one of six job-search categories + a one-line summary. Does NOT
 * touch the fit-scoring prompt (CLAUDE.md invariant).
 */
import { getClient, ChatMessage, LLMClient } from './llm';
import type { MailCategory } from './types';

const CATEGORIES: MailCategory[] = ['applied', 'shortlisted', 'action_needed', 'assessment', 'rejection', 'other'];

export const MAIL_CLASSIFY_PROMPT = `You triage a job-seeker's incoming email into exactly ONE category, from the sender, subject, and snippet.

Categories:
- applied: confirmation that an application was received ("thanks for applying", "we received your application", auto-acknowledgements).
- shortlisted: positive progress — recruiter wants to move forward, interview invite, "next steps", phone screen, "we'd like to schedule".
- action_needed: they need information or a decision from the applicant to proceed (reply with availability, confirm details, fill a form, schedule a time) — but it is NOT a coding test / take-home.
- assessment: an assignment, take-home project, coding test, online assessment (HackerRank/Codility), or screening questions to COMPLETE.
- rejection: not moving forward / position filled / "decided to pursue other candidates".
- other: anything not clearly job-application related (newsletters, alerts, promotions, generic mail).

Pick the single best category. If it isn't clearly about a job application, use "other".

RESPOND IN EXACTLY THIS FORMAT, nothing else:
CATEGORY: [applied|shortlisted|action_needed|assessment|rejection|other]
SUMMARY: [one short sentence — what it is and any deadline/action]`;

export interface MailClassification {
  category: MailCategory;
  summary: string;
}

export function parseMailResponse(response: string): MailClassification {
  let category: MailCategory = 'other';
  let summary = '';
  for (const raw of response.split('\n')) {
    const line = raw.trim();
    if (line.toUpperCase().startsWith('CATEGORY:')) {
      const v = line.slice(9).trim().toLowerCase().replace(/[^a-z_]/g, '');
      if ((CATEGORIES as string[]).includes(v)) category = v as MailCategory;
    } else if (line.toUpperCase().startsWith('SUMMARY:')) {
      summary = line.slice(8).trim();
    }
  }
  return { category, summary };
}

export function buildMailMessages(email: { from: string; subject: string; snippet: string }): ChatMessage[] {
  const user = `FROM: ${email.from}\nSUBJECT: ${email.subject}\nSNIPPET:\n${(email.snippet || '').slice(0, 2000)}`;
  return [
    { role: 'system', content: MAIL_CLASSIFY_PROMPT },
    { role: 'user', content: user },
  ];
}

/** Classify one email. One LLM call (temperature 0). Any error → 'other'. */
export async function classifyEmail(
  email: { from: string; subject: string; snippet: string },
  client?: LLMClient,
): Promise<MailClassification> {
  try {
    const llm = client ?? getClient();
    const response = await llm.chat(buildMailMessages(email), { maxTokens: 120, temperature: 0 });
    return parseMailResponse(response);
  } catch {
    return { category: 'other', summary: '' };
  }
}
