/**
 * AI company assessment (ADR 0009). A SEPARATE LLM call from fit-scoring — it does
 * NOT touch SCORE_PROMPT / the scorer, so the frozen scoring invariant (CLAUDE.md)
 * holds. Run on demand on jobs the user hand-picks, to flag time-waster / spam
 * employers and surface reputable ones.
 *
 * Returns a tier good/medium/low/unknown. The model is told to answer 'unknown'
 * rather than guess when it doesn't recognize the company (anti-hallucination),
 * and any parse/LLM failure yields 'unknown' — never a fabricated tier.
 */
import { getClient, ChatMessage, LLMClient } from './llm';
import type { CompanyTier, Job } from './types';

export interface CompanyAssessment {
  tier: CompanyTier;
  note: string;
}

// ── Prompt ───────────────────────────────────────────────────────────────────
export const COMPANY_PROMPT = `You are an expert job-market analyst. Judge whether the EMPLOYER behind a job posting is a legitimate, worthwhile place to apply, or a likely time-waster.

Use what you actually know about the company (reputation, size, industry standing) PLUS the details provided. The 'low' tier is for genuine TIME-WASTERS / data-harvesters, namely: lead-generation or résumé-upsell schemes, vague shell companies, listings that exist mainly to harvest applicant data or drive you to a paid service, and duplicate/scraped reposts of roles that aren't really being hired.

IMPORTANT — do NOT demote a company to 'low' merely because the role is a CONTRACT / C2C / temporary position, or because a staffing/recruiting firm is hiring for a REAL client role. Legitimate staffing firms and contract positions are normal and worth surfacing — judge them on legitimacy, not on the employment type. Only rate 'low' when the listing itself shows the time-waster / harvesting signals above.

Rate the employer into exactly one TIER:
- good: well-known, reputable, or clearly established employer (or a reputable staffing firm placing for a real client) hiring genuinely.
- medium: plausible real employer or staffing firm but unremarkable or limited information.
- low: likely a lead-gen / résumé-upsell / data-harvesting / shell / fake-repost listing (a real time-waster — not just "it's a contract or a recruiter").
- unknown: you do not recognize the company and the details are insufficient to judge. DO NOT GUESS — use 'unknown' rather than inventing facts.

RESPOND IN EXACTLY THIS FORMAT:
TIER: [good|medium|low|unknown]
NOTE: [one concise sentence explaining the rating]`;

/**
 * Parse the LLM response. Tier is clamped to the four valid values, defaulting to
 * 'unknown' when the TIER line is missing or unrecognized.
 */
export function parseCompanyResponse(response: string): CompanyAssessment {
  let tier: CompanyTier = 'unknown';
  let note = '';

  for (const raw of response.split('\n')) {
    const line = raw.trim();
    if (line.toUpperCase().startsWith('TIER:')) {
      const v = line.slice(5).trim().toLowerCase();
      if (v === 'good' || v === 'medium' || v === 'low' || v === 'unknown') tier = v;
      else tier = 'unknown';
    } else if (line.toUpperCase().startsWith('NOTE:')) {
      note = line.slice(5).trim();
    }
  }

  return { tier, note };
}

/** Build the user message: the company facts we have. Description trimmed to 1500 chars. */
export function buildCompanyMessages(job: Pick<Job, 'company' | 'company_size' | 'location' | 'title' | 'full_description'>): ChatMessage[] {
  const snippet = (job.full_description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1500);
  const facts =
    `COMPANY: ${job.company ?? 'Unknown'}\n` +
    `COMPANY SIZE: ${job.company_size ?? 'N/A'}\n` +
    `LOCATION: ${job.location ?? 'N/A'}\n` +
    `ROLE: ${job.title ?? 'N/A'}\n\n` +
    `POSTING SNIPPET:\n${snippet}`;

  return [
    { role: 'system', content: COMPANY_PROMPT },
    { role: 'user', content: facts },
  ];
}

/**
 * Assess one company. One LLM call (temperature 0 for stable tiers). On any LLM
 * error returns tier 'unknown' with the error in the note — visible, never faked.
 */
export async function assessCompany(
  job: Pick<Job, 'company' | 'company_size' | 'location' | 'title' | 'full_description'>,
  client?: LLMClient,
): Promise<CompanyAssessment> {
  const messages = buildCompanyMessages(job);
  try {
    const llm = client ?? getClient();
    const response = await llm.chat(messages, { maxTokens: 256, temperature: 0 });
    return parseCompanyResponse(response);
  } catch (e) {
    return { tier: 'unknown', note: `assessment error: ${e instanceof Error ? e.message : String(e)}` };
  }
}
