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

CRITICAL: Your entire response MUST start with "Dear Hiring Manager," — write NO sentence, acknowledgement, or commentary before it, and NOTHING after the candidate's name. No preamble, no subject line, no address block, no date, no markdown, no horizontal rules.`;

/**
 * Extract just the letter from the model's reply. The Agent SDK model tends to add a
 * conversational preamble ("I'll write a compelling cover letter…") and/or a trailing
 * note despite the prompt — that text must NOT reach the PDF. Keep from the "Dear …"
 * salutation through the name line that follows the "Sincerely," sign-off.
 */
function extractLetter(raw) {
  let t = String(raw || '').replace(/\r/g, '').replace(/—/g, ', ').trim();
  // Drop any preamble before the salutation.
  const dear = t.search(/(^|\n)[ \t]*Dear\b/i);
  if (dear > 0) t = t.slice(dear).replace(/^\s+/, '');
  // Remove stray markdown horizontal-rule lines the model inserts.
  const lines = t.split('\n').filter((ln) => !/^\s*-{3,}\s*$/.test(ln));
  // Cut any trailing commentary after the sign-off + name: keep through the first
  // non-empty line after "Sincerely,".
  const si = lines.findIndex((ln) => /^\s*Sincerely\b/i.test(ln));
  if (si >= 0) {
    let end = si;
    for (let i = si + 1; i < lines.length; i++) {
      if (lines[i].trim()) { end = i; break; }
    }
    return lines.slice(0, end + 1).join('\n').trim();
  }
  return lines.join('\n').trim();
}

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

/** The job description text. Jobs store it in `full_description` (HTML); fall back to
 *  `description`. Strip tags + collapse whitespace, like tailor.js does. */
function jobDescriptionText(job) {
  return String(job.full_description || job.description || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 8000);
}

function buildMessages(base, job, jd) {
  const jobText = [
    `Role: ${job.title || ''}`,
    job.company ? `Company: ${job.company}` : '',
    job.location ? `Location: ${job.location}` : '',
    '',
    'Job description:',
    jd,
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
  // Guard: with no job description the model can only hedge ("please share the JD"),
  // and that conversational reply would land in the PDF. Fail clearly instead.
  const jd = jobDescriptionText(job);
  if (jd.length < 30) {
    throw new Error('This job has no description text saved — re-fetch the job before writing a cover letter.');
  }

  const text = await client.chat(buildMessages(base, job, jd), { maxTokens: 1200, temperature: 0.4 });
  // Safety net: a real letter ends with "Sincerely,". If the model hedged or asked a
  // question instead of writing one, don't render that into a PDF.
  if (!/sincerely/i.test(String(text || ''))) {
    throw new Error('The model did not return a proper cover letter (no sign-off) — please retry.');
  }
  const cleaned = extractLetter(text); // strip any preamble / trailing commentary
  if (!cleaned) throw new Error('The model returned an empty cover letter.');
  return cleaned;
}
