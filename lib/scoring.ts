/**
 * Job fit scoring v2 (ADR 0022).
 *
 * Evolved from the ApplyPilot-Lite scorer into a weighted, must-have-aware rubric
 * (recruiter persona, seniority logic, per-dimension sub-scores, matched/missing
 * requirements) following open-source résumé↔JD matching standards. Still ONE LLM
 * call per job; a parse failure or LLM error yields score 0 (visible, never
 * fabricated). The scorer also reports the employment type so contract/staffing
 * roles can be flagged.
 */

import { getClient, ChatMessage, LLMClient } from "./llm";
import type { ScorableJob, ScoreResult, ScoreBreakdown, EmploymentType } from "./types";

// ── Scoring Prompt (v2 weighted rubric) ──────────────────────────────────────

export const SCORE_PROMPT = `You are a senior technical recruiter with 15+ years of experience screening candidates. You semantically judge how well a CANDIDATE'S RESUME matches a JOB POSTING — the way an expert recruiter would, not by literal keyword overlap. Use ONLY facts present in the resume; never invent experience, titles, or years.

### PHASE 1 — VALIDATION (do this first)
Inspect the JOB POSTING text.
- If it is NOT a real job description (legal/accessibility disclaimer, login wall, cookie notice, navigation/footer links, an empty or garbled blob), set SCORE to 0 and stop.
- If the role explicitly REQUIRES US Citizenship, a Green Card, or an active Security Clearance, set SCORE to 1 and stop (the candidate cannot meet it).
- Otherwise continue to Phase 2.

### PHASE 2 — WEIGHTED ANALYSIS
Score these five dimensions, then combine them. Judge by intent and demonstrated application, not surface keywords.
1. MUST-HAVE SKILLS & REQUIREMENTS (0–40): the hard requirements the posting treats as essential (core stack, required tools, required years, degree/cert if mandatory). Recruiters split must-have vs nice-to-have: meeting nice-to-haves does NOT compensate for missing must-haves.
2. EXPERIENCE DEPTH & SENIORITY (0–25): does the candidate's years and scope of work match the level the role targets? Penalize both UNDER-qualification (too junior for the role's responsibility) and clear OVER-qualification (a senior/principal forced into an entry role).
3. DOMAIN / ROLE RELEVANCE (0–20): how well the candidate's career trajectory, industry, and the kind of work align with the role's actual purpose.
4. NICE-TO-HAVE / BONUS (0–10): preferred-but-optional skills, adjacent tech, and differentiators the candidate brings.
5. LOGISTICS (0–5): location/remote fit, visa/work-authorization signals, and any stated comp alignment. If unknown, award partial credit; do not penalize for missing info.

### COMBINING INTO THE 1–10 SCORE
Sum the five sub-scores (max 100), then map to 1–10. CRITICAL GATE: if the candidate clearly fails one or more MUST-HAVE requirements, the overall SCORE must not exceed 4, regardless of how strong the other dimensions are.
- 9–10: Exceptional. Meets all must-haves and the seniority fits; a recruiter would fast-track.
- 7–8: Strong. Meets the must-haves with minor, coverable gaps.
- 6: Moderate. Baseline met but notable gaps in a key area.
- 3–5: Weak. Misses must-haves or a significant seniority/domain mismatch.
- 1–2: Non-match. Unrelated background.
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
BREAKDOWN: skills=<0-40> experience=<0-25> domain=<0-20> bonus=<0-10> logistics=<0-5>
KEYWORDS: [comma-separated resume skills that are genuinely relevant to this job]
MISSING: [comma-separated MUST-HAVE requirements the resume does NOT evidence; "none" if all are met]
NOTE: [one concise sentence summarizing the match quality]
REASONING: [3-5 sentences bridging concrete resume facts to the job's must-haves, and stating the seniority fit]`;

// ── Parsing ──────────────────────────────────────────────────────────────────

const EMPLOYMENT_TYPES: EmploymentType[] = ["full_time", "contract", "internship", "unknown"];

function parseBreakdown(line: string): ScoreBreakdown | null {
  const get = (k: string): number | null => {
    const m = line.match(new RegExp(`${k}\\s*=\\s*(\\d+)`, "i"));
    return m ? parseInt(m[1], 10) : null;
  };
  const skills = get("skills");
  const experience = get("experience");
  const domain = get("domain");
  const bonus = get("bonus");
  const logistics = get("logistics");
  if ([skills, experience, domain, bonus, logistics].every((v) => v === null)) return null;
  const clamp = (v: number | null, max: number) => Math.max(0, Math.min(max, v ?? 0));
  return {
    skills: clamp(skills, 40),
    experience: clamp(experience, 25),
    domain: clamp(domain, 20),
    bonus: clamp(bonus, 10),
    logistics: clamp(logistics, 5),
  };
}

/**
 * Parse the LLM response. Line-prefixed fields; score clamped to 0–10 (0 = invalid
 * content). New v2 fields (employment_type, seniority, breakdown, missing) are
 * optional — an old-style response still parses into score/keywords/note/reasoning.
 */
export function parseScoreResponse(response: string): ScoreResult {
  let score = 0;
  let keywords = "";
  let note = "";
  let reasoning = response;
  let employment_type: EmploymentType | null = null;
  let seniority: string | null = null;
  let missing: string | null = null;
  let breakdown: ScoreBreakdown | null = null;

  for (const raw of response.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("SCORE:")) {
      const m = line.match(/\d+/);
      score = m ? Math.max(0, Math.min(10, parseInt(m[0], 10))) : 0;
    } else if (line.toUpperCase().startsWith("EMPLOYMENT:")) {
      const v = line.slice(11).trim().toLowerCase().replace(/[^a-z_]/g, "");
      if ((EMPLOYMENT_TYPES as string[]).includes(v)) employment_type = v as EmploymentType;
    } else if (line.toUpperCase().startsWith("SENIORITY:")) {
      seniority = line.slice(10).trim() || null;
    } else if (line.toUpperCase().startsWith("BREAKDOWN:")) {
      breakdown = parseBreakdown(line.slice(10));
    } else if (line.startsWith("KEYWORDS:")) {
      keywords = line.replace("KEYWORDS:", "").trim();
    } else if (line.toUpperCase().startsWith("MISSING:")) {
      const v = line.slice(8).trim();
      missing = v && v.toLowerCase() !== "none" ? v : "";
    } else if (line.startsWith("NOTE:")) {
      note = line.replace("NOTE:", "").trim();
    } else if (line.startsWith("REASONING:")) {
      reasoning = line.replace("REASONING:", "").trim();
    }
  }

  return { score, keywords, note, reasoning, employment_type, seniority, missing, breakdown };
}

/** Build the user message (job description truncated to 15000 chars). */
export function buildScoreMessages(
  resumeText: string,
  job: ScorableJob,
): ChatMessage[] {
  const description = (job.full_description || job.description || "").slice(0, 15000);
  const jobText =
    `TITLE: ${job.title ?? ""}\n` +
    `COMPANY: ${job.company ?? ""}\n` +
    `LOCATION: ${job.location ?? "N/A"}\n\n` +
    `DESCRIPTION:\n${description}`;

  return [
    { role: "system", content: SCORE_PROMPT },
    {
      role: "user",
      content: `RESUME:\n${resumeText}\n\n---\n\nJOB POSTING:\n${jobText}`,
    },
  ];
}

/**
 * Score a single job against the resume. One LLM call (temperature 0.1,
 * max_tokens 1000 — the richer rubric needs room). On any LLM error returns
 * score 0 (visible failure, never a fabricated score).
 */
export async function scoreJob(
  resumeText: string,
  job: ScorableJob,
  client?: LLMClient,
): Promise<ScoreResult> {
  const messages = buildScoreMessages(resumeText, job);
  try {
    const llm = client ?? getClient();
    const response = await llm.chat(messages, {
      maxTokens: 1000,
      temperature: 0.1,
    });
    return parseScoreResponse(response);
  } catch (e) {
    return {
      score: 0,
      keywords: "",
      note: "",
      reasoning: `LLM error: ${e instanceof Error ? e.message : String(e)}`,
      employment_type: null,
      seniority: null,
      missing: null,
      breakdown: null,
    };
  }
}
