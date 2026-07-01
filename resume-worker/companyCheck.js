/**
 * AI company assessment on the worker (ADR 0009 / ADR 0042). A faithful port of the
 * cloud's lib/companyCheck.ts — same COMPANY_PROMPT, same parser, same "unknown on
 * error, never fabricated" rule. Used by the worker's POST /assess-jobs so subscription-
 * mode assessment (one Agent-SDK call per company) runs in the BACKGROUND here instead of
 * inside a serverless function that could time out. A SEPARATE call from fit-scoring — it
 * does NOT touch the frozen scorer.
 */

// ── Prompt (verbatim parity with lib/companyCheck.ts COMPANY_PROMPT) ──────────
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

/** Parse the LLM response. Tier clamped to the four valid values; 'unknown' by default. */
export function parseCompanyResponse(response) {
  let tier = 'unknown';
  let note = '';
  for (const raw of String(response).split('\n')) {
    const line = raw.trim();
    if (line.toUpperCase().startsWith('TIER:')) {
      const v = line.slice(5).trim().toLowerCase();
      tier = v === 'good' || v === 'medium' || v === 'low' || v === 'unknown' ? v : 'unknown';
    } else if (line.toUpperCase().startsWith('NOTE:')) {
      note = line.slice(5).trim();
    }
  }
  return { tier, note };
}

/** Build the user message: the company facts we have. Description trimmed to 1500 chars. */
export function buildCompanyMessages(job) {
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
 * Assess one company. One LLM call (temperature 0, maxTokens 256). On any error returns
 * tier 'unknown' with the error in the note + `error: true` — visible, never fabricated.
 */
export async function assessCompany(job, client) {
  const messages = buildCompanyMessages(job);
  try {
    const response = await client.chat(messages, { maxTokens: 256, temperature: 0 });
    return parseCompanyResponse(response);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[assessCompany] FAIL company="${job.company ?? ''}": ${msg}`);
    return { tier: 'unknown', note: `assessment error: ${msg}`, error: true };
  }
}
