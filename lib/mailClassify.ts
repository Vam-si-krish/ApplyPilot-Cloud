/**
 * Mail classifier (ADR 0012). A separate, cheap LLM call that sorts an incoming
 * email into one of six job-search categories + a one-line summary. Does NOT
 * touch the fit-scoring prompt (CLAUDE.md invariant).
 */
import { getClient, ChatMessage, LLMClient } from './llm';
import type { MailCategory, MailApplySource } from './types';

const CATEGORIES: MailCategory[] = ['recruiter', 'applied', 'shortlisted', 'action_needed', 'assessment', 'rejection', 'other'];
const SOURCES: MailApplySource[] = ['easy_apply', 'company_portal'];

export const MAIL_CLASSIFY_PROMPT = `You ARE an active job-seeker reading your own inbox. Read each email the way a person hunting for a job would and decide: what does this mean for my search, and do I need to act? Then put it in exactly ONE category, using the sender, subject, and snippet.

Categories (a job-seeker's mental buckets):
- recruiter: a recruiter, sourcer, hiring manager, or staffing/consulting firm is PROACTIVELY reaching out to YOU about a NEW role or opportunity that you did NOT apply for — introducing a job, asking if you're interested/available, asking for your updated resume, rate, work authorization, or to set up an intro call. This is a real human opening a new door. A genuine personal outreach about a specific role is recruiter even when it asks you to reply (the new opportunity is what defines it). This is one of the MOST important things in the inbox — never bury it in "other".
- applied: confirmation that an application YOU submitted was received ("thanks for applying", "we received your application", auto-acknowledgements).
- shortlisted: positive progress on a role you ARE already in the pipeline for — interview invite, "next steps", phone screen, "we'd like to schedule", moving forward.
- action_needed: an application/process ALREADY in motion needs information or a decision from you to proceed (reply with availability, confirm details, fill a NON-TEST form, schedule a time). EXCLUDES three things: an assessment/coding test/take-home to complete (that's "assessment"), a brand-new recruiter introduction (that's "recruiter"), and transactional verification/security mail like one-time passcodes (that's "other").
- assessment: an invitation or request to COMPLETE or SUBMIT a take-home project, coding test, online assessment (HackerRank, Codility, CodeSignal, Karat, HackerEarth), a skills test, screening questions, or a recorded/one-way video interview (e.g. HireVue). This takes PRECEDENCE over action_needed: if the email asks you to take or submit an assessment, choose "assessment" even when it's phrased as "required to move forward" / "complete this to proceed".
- rejection: not moving forward / position filled / "decided to pursue other candidates".
- other: NOT a personal step in your job search. Automated job-alert digests and "N new jobs matching your search" emails, newsletters, promotions, marketing, course/webinar ads, social notifications, generic mail — even when they come from LinkedIn/Indeed/job boards. A bulk blast or an automated alert is "other", not "recruiter". ALSO transactional/automated security mail — one-time passcodes (OTP), email or login verification codes, two-factor (2FA) codes, password resets, and sign-in/security alerts — is ALWAYS "other", NEVER "action_needed", even when it says "action required", "verify now", or "use this code".

Decide from the job-seeker's point of view, not by keywords alone. The key question for "recruiter" vs "other": is a real person opening a NEW opportunity to ME specifically (recruiter), or is this an automated/bulk message (other)? When a recruiter email is a genuine personal outreach about a specific role, choose "recruiter" even if it also asks you to do something.

Precedence when an email could fit two buckets: (1) anything asking you to COMPLETE or SUBMIT a test/assignment/assessment is "assessment", not "action_needed"; (2) one-time passcodes, verification/2FA codes, password resets and security/sign-in alerts are ALWAYS "other", never "action_needed".

Also report HOW the application was submitted, judging mainly by the SENDER:
- easy_apply: you applied WITHIN a job board / aggregator and the confirmation comes from that platform — LinkedIn (linkedin.com), Indeed (indeed.com), Glassdoor (glassdoor.com), ZipRecruiter, Monster, Dice, Wellfound/AngelList, SimplyHired, CareerBuilder, etc. (e.g. LinkedIn "Easy Apply", "Indeed Apply").
- company_portal: you applied on the company's OWN site or its applicant tracking system — Greenhouse (greenhouse.io), Lever (lever.co), Workday (myworkday.com), Ashby (ashbyhq.com), iCIMS (icims.com), Workable (workable.com), SmartRecruiters, Taleo (taleo.net), Jobvite, BambooHR, etc., or the company's own domain (careers@/talent@/recruiting@).
- none: the email is not a job application you submitted (newsletters, alerts, generic mail).

RESPOND IN EXACTLY THIS FORMAT, nothing else:
CATEGORY: [recruiter|applied|shortlisted|action_needed|assessment|rejection|other]
SOURCE: [easy_apply|company_portal|none]
SUMMARY: [one short sentence — what it is and any deadline/action]
COMPANY: [hiring company explicitly named in the message, or NONE]
ROLE: [job title explicitly named in the message, or NONE]
EVENT_TYPE: [assessment|interview|none]
EVENT_ACTION: [active|complete|none]
EVENT_START: [ISO 8601 timestamp with timezone, or NONE]
EVENT_END: [ISO 8601 timestamp with timezone, or NONE]

Calendar rules:
- assessment: populate only when the email explicitly gives an opening/start time or deadline/expiry. START is when it becomes available. END is its deadline. A lone deadline belongs in END.
- interview: populate only for an explicitly scheduled or confirmed interview date/time. START is the interview time. END is present only when an end time or duration is explicit. This may accompany recruiter mail when the new-opportunity message already confirms a call. An invitation that merely asks the candidate to choose availability has no calendar event yet.
- none: every other message.
- EVENT_ACTION active creates/updates a dated event from this email. EVENT_ACTION complete is ONLY for an explicit confirmation that the candidate finished/submitted the assessment, or an explicit post-interview confirmation/follow-up proving the interview happened. A generic invitation, reminder, application confirmation, or "thanks for applying" is never complete. Completion mail may have no event dates; preserve EVENT_TYPE so it can be matched to the earlier event.
Never invent a date or timezone. You may resolve explicit relative wording such as "tomorrow" from RECEIVED_AT. When a time is stated without a timezone, use USER_TIMEZONE and preserve that offset in the ISO result.`;

// Confirmation senders that pin the source deterministically (ADR 0021, broadened).
// Job boards / aggregators → you applied within the platform = easy_apply.
const JOB_BOARD_DOMAINS = [
  'linkedin.com', 'indeed.com', 'indeedemail.com', 'glassdoor.com', 'ziprecruiter.com',
  'monster.com', 'dice.com', 'wellfound.com', 'angel.co', 'simplyhired.com', 'careerbuilder.com', 'lensa.com',
];
// Applicant tracking systems → you applied on the company's portal = company_portal.
const ATS_DOMAINS = [
  'greenhouse.io', 'greenhouse-mail.io', 'us.greenhouse-mail.io', 'lever.co', 'hire.lever.co',
  'myworkday.com', 'workday.com', 'ashbyhq.com', 'icims.com', 'workable.com', 'workablemail.com',
  'smartrecruiters.com', 'taleo.net', 'jobvite.com', 'bamboohr.com', 'breezy.hr', 'recruitee.com',
  'teamtailor.com', 'jazzhr.com', 'jazz.co', 'successfactors.com', 'oraclecloud.com',
];

/** Pin apply source by sender domain when it's an obvious job board or ATS; else null (let the AI decide). */
export function domainApplySource(fromEmail: string | null | undefined): MailApplySource | null {
  if (!fromEmail) return null;
  const at = fromEmail.lastIndexOf('@');
  const domain = (at >= 0 ? fromEmail.slice(at + 1) : fromEmail).toLowerCase().trim();
  if (!domain) return null;
  const hit = (list: string[]) => list.some((d) => domain === d || domain.endsWith('.' + d));
  if (hit(JOB_BOARD_DOMAINS)) return 'easy_apply';
  if (hit(ATS_DOMAINS)) return 'company_portal';
  return null;
}

export interface MailClassification {
  category: MailCategory;
  /** How the application was submitted — null when not an application (ADR 0021). */
  apply_source: MailApplySource | null;
  summary: string;
  company_name: string | null;
  role_title: string | null;
  assessment_start_at: string | null;
  assessment_end_at: string | null;
  calendar_event_kind: 'assessment' | 'interview' | null;
  calendar_start_at: string | null;
  calendar_end_at: string | null;
  calendar_action: 'active' | 'complete' | null;
}

function parsedTimestamp(value: string): string | null {
  const clean = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}.*(?:Z|[+-]\d{2}:\d{2})$/.test(clean)) return null;
  const ms = Date.parse(clean);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

export function parseMailResponse(response: string): MailClassification {
  let category: MailCategory = 'other';
  let apply_source: MailApplySource | null = null;
  let summary = '';
  let company_name: string | null = null;
  let role_title: string | null = null;
  let assessment_start_at: string | null = null;
  let assessment_end_at: string | null = null;
  let calendar_event_kind: 'assessment' | 'interview' | null = null;
  let calendar_start_at: string | null = null;
  let calendar_end_at: string | null = null;
  let calendar_action: 'active' | 'complete' | null = null;
  for (const raw of response.split('\n')) {
    const line = raw.trim();
    if (line.toUpperCase().startsWith('CATEGORY:')) {
      const v = line.slice(9).trim().toLowerCase().replace(/[^a-z_]/g, '');
      if ((CATEGORIES as string[]).includes(v)) category = v as MailCategory;
    } else if (line.toUpperCase().startsWith('SOURCE:')) {
      const v = line.slice(7).trim().toLowerCase().replace(/[^a-z_]/g, '');
      if ((SOURCES as string[]).includes(v)) apply_source = v as MailApplySource;
    } else if (line.toUpperCase().startsWith('SUMMARY:')) {
      summary = line.slice(8).trim().slice(0, 500);
    } else if (line.toUpperCase().startsWith('COMPANY:')) {
      const value = line.slice(8).trim();
      company_name = value && value.toUpperCase() !== 'NONE' ? value.slice(0, 200) : null;
    } else if (line.toUpperCase().startsWith('ROLE:')) {
      const value = line.slice(5).trim();
      role_title = value && value.toUpperCase() !== 'NONE' ? value.slice(0, 200) : null;
    } else if (line.toUpperCase().startsWith('ASSESSMENT_START:')) {
      assessment_start_at = parsedTimestamp(line.slice(17));
    } else if (line.toUpperCase().startsWith('ASSESSMENT_END:')) {
      assessment_end_at = parsedTimestamp(line.slice(15));
    } else if (line.toUpperCase().startsWith('EVENT_TYPE:')) {
      const value = line.slice(11).trim().toLowerCase();
      if (value === 'assessment' || value === 'interview') calendar_event_kind = value;
    } else if (line.toUpperCase().startsWith('EVENT_START:')) {
      calendar_start_at = parsedTimestamp(line.slice(12));
    } else if (line.toUpperCase().startsWith('EVENT_END:')) {
      calendar_end_at = parsedTimestamp(line.slice(10));
    } else if (line.toUpperCase().startsWith('EVENT_ACTION:')) {
      const value = line.slice(13).trim().toLowerCase();
      if (value === 'active' || value === 'complete') calendar_action = value;
    }
  }
  // Backward-compatible parser support for stored fixtures and older model replies.
  if (!calendar_event_kind && category === 'assessment' && (assessment_start_at || assessment_end_at)) {
    calendar_event_kind = 'assessment';
    calendar_start_at = assessment_start_at;
    calendar_end_at = assessment_end_at;
    calendar_action = 'active';
  }
  const kindMatchesCategory = calendar_action === 'complete' ? true : calendar_event_kind === 'assessment'
    ? category === 'assessment'
    : calendar_event_kind === 'interview'
      ? category === 'shortlisted' || category === 'action_needed' || category === 'recruiter'
      : true;
  if (!kindMatchesCategory || (calendar_action !== 'complete' && !calendar_start_at && !calendar_end_at) || (calendar_start_at && calendar_end_at && calendar_end_at < calendar_start_at)) {
    calendar_event_kind = null;
    calendar_start_at = null;
    calendar_end_at = null;
    calendar_action = null;
  }
  if (category !== 'assessment') {
    assessment_start_at = null;
    assessment_end_at = null;
  } else if (assessment_start_at && assessment_end_at && assessment_end_at < assessment_start_at) {
    assessment_start_at = null;
    assessment_end_at = null;
  }
  if (calendar_event_kind === 'assessment') {
    assessment_start_at = calendar_start_at;
    assessment_end_at = calendar_end_at;
  }
  if (calendar_event_kind && !calendar_action) calendar_action = calendar_start_at || calendar_end_at ? 'active' : null;
  return { category, apply_source, summary, company_name, role_title, assessment_start_at, assessment_end_at, calendar_event_kind, calendar_start_at, calendar_end_at, calendar_action };
}

export function buildMailMessages(email: { from: string; subject: string; snippet: string; body?: string; receivedAt?: string | null; timezone?: string }): ChatMessage[] {
  const user = `FROM: ${email.from}\nSUBJECT: ${email.subject}\nRECEIVED_AT: ${email.receivedAt || 'unknown'}\nUSER_TIMEZONE: ${email.timezone || 'UTC'}\nSNIPPET:\n${(email.snippet || '').slice(0, 3000)}\nBODY:\n${(email.body || '').slice(0, 30000)}`;
  return [
    { role: 'system', content: MAIL_CLASSIFY_PROMPT },
    { role: 'user', content: user },
  ];
}

/** Classify one email. One LLM call (temperature 0). Any error → 'other'. */
export async function classifyEmail(
  email: { from: string; subject: string; snippet: string; body?: string; receivedAt?: string | null; timezone?: string },
  client?: LLMClient,
): Promise<MailClassification> {
  try {
    const llm = client ?? getClient();
    const response = await llm.chat(buildMailMessages(email), { maxTokens: 340, temperature: 0 });
    return parseMailResponse(response);
  } catch {
    return { category: 'other', apply_source: null, summary: '', company_name: null, role_title: null, assessment_start_at: null, assessment_end_at: null, calendar_event_kind: null, calendar_start_at: null, calendar_end_at: null, calendar_action: null };
  }
}
