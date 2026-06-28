/**
 * Job scoring logic for the worker (mirrors lib/scoring.ts).
 * Used by POST /score-jobs so the worker can score jobs fully in the background
 * without routing individual LLM calls back through Netlify (which times out).
 */

export const SCORE_PROMPT = `You are a senior technical recruiter with 15+ years of experience screening candidates. Your task: predict how likely THIS candidate is to be SHORTLISTED for THIS role if they applied — i.e. whether it is worth their time to apply. Judge the resume↔posting fit the way an expert recruiter would, semantically, not by literal keyword overlap.

ANTI-FABRICATION (critical, read twice): Use ONLY facts the RESUME actually states. Never invent or inflate experience, titles, years, skills, or education. Crucially, a requirement in the POSTING is NOT evidence about the candidate — if the job says "8+ years" that tells you nothing about how many years the candidate has. Do not echo the posting's numbers back as if they were the candidate's. If the resume does not show something, treat it as absent and say so plainly.

### PHASE 1 — VALIDATION (do this first)
Inspect the JOB POSTING text.
- If it is NOT a real job description (legal/accessibility disclaimer, login wall, cookie notice, navigation/footer links, an empty or garbled blob), set SCORE to 0 and stop.
- HARD BLOCK — if the posting requires ANY of the following, set SCORE to 1 and STOP, regardless of how well the skills, seniority, or domain match (skill fit is irrelevant here — the candidate simply cannot be considered):
  • US Citizenship — "US Citizen", "U.S. citizen", "USC", "must be a US citizen", "citizenship required".
  • Lawful permanent residency / Green Card — "Green Card holder", "permanent resident required".
  • An active or obtainable Security Clearance — "Secret", "Top Secret", "TS/SCI", "Public Trust", "Q clearance", "DoD/active clearance", "ability to obtain a clearance".
  • Citizenship-restricted authorization — e.g. ITAR/EAR "US Persons only".
  Set SCORE to 1, note the blocker, and stop. (Do NOT use 0 — that is reserved for invalid/non-job content.)
- Otherwise continue to Phase 2.

### PHASE 2 — ANALYSIS
FIRST, establish the candidate's EVIDENCED years of relevant experience from the RESUME ONLY — add up role date ranges, or use an explicit "X years" claim in the resume. If the resume gives no basis, treat years as "not specified". Never borrow the posting's required-years number.

The candidate will TAILOR their résumé before applying (truthful reframing — re-emphasising real experience, never inventing skills). So judge "fit" as how competitive a strong *tailored* version would be, then score these THREE dimensions and combine them. Judge by intent and demonstrated application, not surface keywords.
1. MUST-HAVE SKILLS & REQUIREMENTS (0–60): the hard requirements the posting treats as essential (core technical stack, required tools, a mandatory degree/cert/license). TAILORING-AWARE: credit a skill the candidate GENUINELY has even if the base résumé only mentions it in passing or phrases it differently — a tailored résumé will foreground it. But NEVER credit a core skill the candidate does not actually have; tailoring cannot manufacture real experience and the gap would surface in an interview. A "years of experience" number is a SOFT requirement, not a hard gate — recruiters routinely shortlist strong candidates a couple of years under it; treat a modest years shortfall (~2–3 years) as at most a small deduction, never a disqualifier.
2. ROLE RELEVANCE (0–25): how well the candidate's career trajectory and the kind of work they actually do align with the role's real purpose. This is the irrelevance guard — a role outside the candidate's discipline (e.g. a frontend engineer vs. a mechanical-engineering or sales role) scores near 0 here even if a few keywords overlap. Same-discipline roles in a different industry should still score well; industry vertical matters far less than role type.
3. EXPERIENCE DEPTH & SENIORITY (0–15): can the candidate demonstrably DO this job, given their shown scope and depth? Award full or near-full credit when the candidate meets OR EXCEEDS the level the role needs. Being MORE experienced than the role asks (overqualified) is NOT a negative for getting shortlisted — deduct only a little, and only on a genuine seniority-band collision (e.g. a Principal applying to a true entry-level or internship role). Penalize only CLEAR under-qualification — the candidate plainly lacks the depth and scope the responsibilities demand (not merely a smaller years number than the posting lists).

(Location/remote and comp are NOT scored dimensions — mention any concern in the NOTE. Work-authorization HARD blockers are already handled in Phase 1.)

### COMBINING INTO THE 1–10 SCORE
Sum the three sub-scores (max 100), then map to 1–10.
CRITICAL GATE: if the candidate clearly lacks one or more CORE must-have SKILLS / hard requirements (the essential technical stack, a mandatory degree/cert/license, or a Phase-1 blocker), the overall SCORE must not exceed 4 — no matter how strong the other dimensions are. A years-of-experience shortfall, by itself, is NOT a must-have failure and must NOT trigger this cap. Overqualification is NEVER a reason to score low.
- 9–10: Exceptional. Has the core skills and the depth to do the job; a recruiter would fast-track. (Exceeding the required level still belongs here.)
- 7–8: Strong. Has the core skills with minor, coverable gaps (including a modest years shortfall).
- 6: Moderate. Core baseline met but notable gaps in a key area.
- 3–5: Weak. Missing core skills, or a significant role mismatch.
- 1–2: Non-match. The candidate's background is unrelated to the role, or a Phase-1 hard blocker applies. (Being overqualified is NOT a non-match.)
- 0: INVALID CONTENT (not a job posting).

### EMPLOYMENT TYPE
From the posting wording, classify the role:
- contract: contract, C2C, corp-to-corp, 1099, W2 contract, contract-to-hire, temporary, fixed-term, or a staffing/consulting placement.
- internship: intern / co-op / trainee.
- full_time: a permanent direct-hire role.
- unknown: not stated.

RESPOND IN EXACTLY THIS FORMAT, nothing else:
SCORE: [0-10]
EMPLOYMENT: [full_time|contract|internship|unknown]
SENIORITY: [strong_fit|overqualified|underqualified|unclear]
BREAKDOWN: skills=<0-60> domain=<0-25> experience=<0-15>
KEYWORDS: [comma-separated resume skills that are genuinely relevant to this job]
MISSING: [comma-separated MUST-HAVE requirements the resume does NOT evidence; "none" if all are met]
NOTE: [one concise sentence summarizing the match quality]
REASONING: [3-5 sentences bridging concrete resume facts to the job's must-haves. State the candidate's EVIDENCED years of experience from the resume (or "not specified") and how it compares to any required years — NEVER claim the candidate meets a years/seniority bar the resume does not actually show. State the seniority fit, and remember overqualification is not a penalty for shortlisting.]`;

const EMPLOYMENT_TYPES = ['full_time', 'contract', 'internship', 'unknown'];

function parseBreakdown(line) {
  const get = (k) => {
    const m = line.match(new RegExp(`${k}\\s*=\\s*(\\d+)`, 'i'));
    return m ? parseInt(m[1], 10) : null;
  };
  const skills = get('skills');
  const experience = get('experience');
  const domain = get('domain');
  if ([skills, experience, domain].every((v) => v === null)) return null;
  const clamp = (v, max) => Math.max(0, Math.min(max, v ?? 0));
  return { skills: clamp(skills, 60), domain: clamp(domain, 25), experience: clamp(experience, 15) };
}

export function parseScoreResponse(response) {
  let score = 0, keywords = '', note = '', reasoning = response;
  let employment_type = null, seniority = null, missing = null, breakdown = null;
  for (const raw of response.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('SCORE:')) {
      const m = line.match(/\d+/);
      score = m ? Math.max(0, Math.min(10, parseInt(m[0], 10))) : 0;
    } else if (line.toUpperCase().startsWith('EMPLOYMENT:')) {
      const v = line.slice(11).trim().toLowerCase().replace(/[^a-z_]/g, '');
      if (EMPLOYMENT_TYPES.includes(v)) employment_type = v;
    } else if (line.toUpperCase().startsWith('SENIORITY:')) {
      seniority = line.slice(10).trim() || null;
    } else if (line.toUpperCase().startsWith('BREAKDOWN:')) {
      breakdown = parseBreakdown(line.slice(10));
    } else if (line.startsWith('KEYWORDS:')) {
      keywords = line.replace('KEYWORDS:', '').trim();
    } else if (line.toUpperCase().startsWith('MISSING:')) {
      const v = line.slice(8).trim();
      missing = v && v.toLowerCase() !== 'none' ? v : '';
    } else if (line.startsWith('NOTE:')) {
      note = line.replace('NOTE:', '').trim();
    } else if (line.startsWith('REASONING:')) {
      reasoning = line.replace('REASONING:', '').trim();
    }
  }
  return { score, keywords, note, reasoning, employment_type, seniority, missing, breakdown };
}

export function buildScoreMessages(resumeText, job) {
  const description = (job.full_description || job.description || '').slice(0, 15000);
  const jobText =
    `TITLE: ${job.title ?? ''}\n` +
    `COMPANY: ${job.company ?? ''}\n` +
    `LOCATION: ${job.location ?? 'N/A'}\n\n` +
    `DESCRIPTION:\n${description}`;
  return [
    { role: 'system', content: SCORE_PROMPT },
    { role: 'user', content: `RESUME:\n${resumeText}\n\n---\n\nJOB POSTING:\n${jobText}` },
  ];
}

/** Score one job. Returns score=0 on LLM error (never fabricated). */
export async function scoreJobWorker(resumeText, job, client) {
  const messages = buildScoreMessages(resumeText, job);
  try {
    const response = await client.chat(messages, { maxTokens: 1000, temperature: 0.1 });
    return parseScoreResponse(response);
  } catch (e) {
    return {
      score: 0, keywords: '', note: '',
      reasoning: `LLM error: ${e instanceof Error ? e.message : String(e)}`,
      employment_type: null, seniority: null, missing: null, breakdown: null,
    };
  }
}
