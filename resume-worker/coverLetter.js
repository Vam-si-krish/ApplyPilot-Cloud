/**
 * Cover-letter generation (ADR 0035). One LLM call on the TAILORING model that turns
 * the base résumé + the job into a short, truthful cover letter. Same discipline as
 * résumé tailoring: use only what's in the résumé — never invent employers, titles,
 * dates, metrics, or skills. Returns the letter body as plain text (salutation →
 * paragraphs → "Sincerely," → name); the template adds the contact header + date.
 */

export const COVER_LETTER_PROMPT = `You write a concise, truthful, professional cover letter for a job application, in the candidate's own voice.

Use ONLY facts present in the candidate's résumé below — never invent employers, job titles, dates, metrics, skills, or experiences. Map the candidate's real, most-relevant experience to what THIS role needs.

Style:
- Exactly 3 short paragraphs, ~250-320 words total. Plain, specific, confident. No clichés and no AI-tell words (leverage, utilize, robust, seamless, spearhead, passionate, dynamic, thrilled). Never use an em-dash; use a comma.
- Paragraph 1: name the role and company, and a one-line hook on why you fit.
- Paragraph 2: 2-3 concrete, relevant accomplishments or skills drawn from the résumé that match the job.
- Paragraph 3: a brief close and a call to talk.
- Begin with "Dear Hiring Manager," on its own line. End with "Sincerely," on its own line, then the candidate's full name on the next line.

Output ONLY the letter text — no preamble, no subject line, no address block, no date, no markdown.`;

/** A compact text view of the base résumé for the user message. */
function resumeContext(base) {
  const b = (base && base.basics) || {};
  const lines = [];
  if (b.name) lines.push(`Name: ${b.name}`);
  if (b.label) lines.push(`Headline: ${b.label}`);
  if (b.location) lines.push(`Location: ${b.location}`);
  if (b.summary) lines.push(`Summary: ${b.summary}`);
  const work = Array.isArray(base && base.work) ? base.work : [];
  if (work.length) {
    lines.push('', 'Experience:');
    for (const w of work.slice(0, 6)) {
      const when = [w.startDate, w.endDate].filter(Boolean).join('–');
      lines.push(`- ${w.position || ''}${w.name ? ` at ${w.name}` : ''}${when ? ` (${when})` : ''}`);
      for (const h of (w.highlights || []).slice(0, 4)) lines.push(`    • ${h}`);
    }
  }
  const skills = Array.isArray(base && base.skills) ? base.skills : [];
  if (skills.length) {
    const flat = skills.flatMap((s) => s.keywords || []).slice(0, 40);
    if (flat.length) lines.push('', `Skills: ${flat.join(', ')}`);
  }
  return lines.join('\n');
}

function buildMessages(base, job) {
  const jobText = [
    `Role: ${job.title || ''}`,
    job.company ? `Company: ${job.company}` : '',
    job.location ? `Location: ${job.location}` : '',
    '',
    'Job description:',
    String(job.description || '').slice(0, 8000),
  ]
    .filter(Boolean)
    .join('\n');

  const user = `CANDIDATE RÉSUMÉ:\n${resumeContext(base)}\n\n---\n\nJOB:\n${jobText}`;
  return [
    { role: 'system', content: COVER_LETTER_PROMPT },
    { role: 'user', content: user },
  ];
}

/**
 * Generate the cover-letter text. One LLM call (temperature a touch warm for voice).
 * Throws on an empty/blank response so the caller records an error rather than an
 * empty PDF.
 */
export async function generateCoverLetter(base, job, client) {
  if (!base || !Array.isArray(base.work) || base.work.length === 0) {
    throw new Error('Base résumé is empty — build it under Applications → Base résumé first.');
  }
  const text = await client.chat(buildMessages(base, job), { maxTokens: 1200, temperature: 0.4 });
  const cleaned = String(text || '')
    .replace(/—/g, ', ') // strip em-dashes per house style
    .trim();
  if (!cleaned) throw new Error('The model returned an empty cover letter.');
  return cleaned;
}
