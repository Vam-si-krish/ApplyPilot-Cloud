/**
 * Mail classifier (ADR 0012). A separate, cheap LLM call that sorts an incoming
 * email into one of six job-search categories + a one-line summary. Does NOT
 * touch the fit-scoring prompt (CLAUDE.md invariant).
 */
import { getClient, ChatMessage, LLMClient } from './llm';
import type { MailCategory, MailApplySource } from './types';

const CATEGORIES: MailCategory[] = ['applied', 'shortlisted', 'action_needed', 'assessment', 'rejection', 'other'];
const SOURCES: MailApplySource[] = ['easy_apply', 'company_portal'];

export const MAIL_CLASSIFY_PROMPT = `You triage a job-seeker's incoming email into exactly ONE category, from the sender, subject, and snippet.

Categories:
- applied: confirmation that an application was received ("thanks for applying", "we received your application", auto-acknowledgements).
- shortlisted: positive progress — recruiter wants to move forward, interview invite, "next steps", phone screen, "we'd like to schedule".
- action_needed: they need information or a decision from the applicant to proceed (reply with availability, confirm details, fill a form, schedule a time) — but it is NOT a coding test / take-home.
- assessment: an assignment, take-home project, coding test, online assessment (HackerRank/Codility), or screening questions to COMPLETE.
- rejection: not moving forward / position filled / "decided to pursue other candidates".
- other: anything not clearly job-application related (newsletters, alerts, promotions, generic mail).

Pick the single best category. If it isn't clearly about a job application, use "other".

Also report HOW the application was submitted, judging mainly by the SENDER:
- easy_apply: the email is from LinkedIn (sender domain linkedin.com) — a LinkedIn "Easy Apply" application ("your application was sent", "you applied on LinkedIn").
- company_portal: it's from the company directly (careers@/talent@/recruiting@ their own domain) or an applicant tracking system — Greenhouse (greenhouse.io), Lever (lever.co), Workday (myworkday.com), Ashby (ashbyhq.com), iCIMS (icims.com), Workable (workable.com), SmartRecruiters, Taleo (taleo.net), Jobvite, BambooHR, etc.
- none: the email is not a job application you submitted (newsletters, alerts, generic mail).

RESPOND IN EXACTLY THIS FORMAT, nothing else:
CATEGORY: [applied|shortlisted|action_needed|assessment|rejection|other]
SOURCE: [easy_apply|company_portal|none]
SUMMARY: [one short sentence — what it is and any deadline/action]`;

export interface MailClassification {
  category: MailCategory;
  /** How the application was submitted — null when not an application (ADR 0021). */
  apply_source: MailApplySource | null;
  summary: string;
}

export function parseMailResponse(response: string): MailClassification {
  let category: MailCategory = 'other';
  let apply_source: MailApplySource | null = null;
  let summary = '';
  for (const raw of response.split('\n')) {
    const line = raw.trim();
    if (line.toUpperCase().startsWith('CATEGORY:')) {
      const v = line.slice(9).trim().toLowerCase().replace(/[^a-z_]/g, '');
      if ((CATEGORIES as string[]).includes(v)) category = v as MailCategory;
    } else if (line.toUpperCase().startsWith('SOURCE:')) {
      const v = line.slice(7).trim().toLowerCase().replace(/[^a-z_]/g, '');
      if ((SOURCES as string[]).includes(v)) apply_source = v as MailApplySource;
    } else if (line.toUpperCase().startsWith('SUMMARY:')) {
      summary = line.slice(8).trim();
    }
  }
  return { category, apply_source, summary };
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
    const response = await llm.chat(buildMailMessages(email), { maxTokens: 160, temperature: 0 });
    return parseMailResponse(response);
  } catch {
    return { category: 'other', apply_source: null, summary: '' };
  }
}
