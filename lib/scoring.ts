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
import { stripHtml } from "./prefilter";
import type { ScorableJob, ScoreResult, ScoreBreakdown, EmploymentType, CompanyTier } from "./types";

// ── Scoring Prompt (v2 weighted rubric) ──────────────────────────────────────

export const SCORE_PROMPT = `You are a senior technical recruiter with 15+ years of experience screening candidates. Your task: predict how likely THIS candidate is to be SHORTLISTED for THIS role if they applied — i.e. whether it is worth their time to apply. Judge the resume↔posting fit the way an expert recruiter would, semantically, not by literal keyword overlap.

ANTI-FABRICATION (critical, read twice): Use ONLY facts the CANDIDATE CONTEXT actually states. It contains the candidate's résumé and may contain user-maintained profile facts such as work authorization. Never invent or inflate experience, titles, years, skills, education, citizenship, residency, clearance, or sponsorship needs. Crucially, a requirement in the POSTING is NOT evidence about the candidate — if the job says "8+ years" that tells you nothing about how many years the candidate has. Do not echo the posting's numbers back as if they were the candidate's. If the context does not show something, treat it as unknown and say so plainly.

### PHASE 1 — VALIDATION (do this first)
Inspect the JOB POSTING text.
- If it is NOT a real job description (legal/accessibility disclaimer, login wall, cookie notice, navigation/footer links, an empty or garbled blob), set SCORE to 0 and stop.
- HARD BLOCK — set SCORE to 1 and STOP only when BOTH are true: (a) the posting has a non-negotiable eligibility requirement and (b) the CANDIDATE CONTEXT explicitly proves this candidate cannot satisfy it. Relevant requirements include:
  • US citizenship, lawful permanent residency / Green Card, or ITAR/EAR "US Persons only" restrictions.
  • An active or obtainable security clearance (Secret, Top Secret, TS/SCI, Public Trust, Q, DoD, etc.).
  • Current legal work authorization.
  • No visa sponsorship, now or in the future ("we do not/will not sponsor", "unable to sponsor", "must not now or in the future require sponsorship", etc.). This is a blocker only when the candidate context explicitly says the candidate requires sponsorship now or in the future.
  Never assume every candidate has the same immigration, citizenship, residency, or clearance status. A missing/blank profile field means UNKNOWN, not "no". If eligibility is unknown, continue to Phase 2 and mention exactly what the candidate should confirm in NOTE; do not hard-block. Likewise, a posting that merely asks whether the candidate is currently authorized is not a blocker when the context says they are currently authorized.
  When a hard block is proven, note the candidate-specific blocker and stop. (Do NOT use 0 — that is reserved for invalid/non-job content.)
- USER AVOIDANCE PREFERENCES are also decisive. If scoring_preferences explicitly sets avoid_security_clearance_jobs=true, set SCORE to 1 for any role requiring or requiring eligibility to obtain a security clearance. If it sets avoid_citizenship_restricted_jobs=true, set SCORE to 1 for any citizenship/Green-Card/US-Person-restricted role. State that this is the user's preference, not an inferred eligibility failure.
- Otherwise continue to Phase 2.

### PHASE 2 — ANALYSIS
FIRST, establish the candidate's EVIDENCED years of relevant experience from the RESUME ONLY — add up role date ranges, or use an explicit "X years" claim in the resume. If the resume gives no basis, treat years as "not specified". Never borrow the posting's required-years number.

The candidate will TAILOR their résumé before applying (truthful reframing — re-emphasising real experience, never inventing skills). So judge "fit" as how competitive a strong *tailored* version would be, then score these THREE dimensions and combine them. Judge by intent and demonstrated application, not surface keywords.
1. MUST-HAVE SKILLS & REQUIREMENTS (0–60): the hard requirements the posting treats as essential (core technical stack, required tools, a mandatory degree/cert/license). TAILORING-AWARE: credit a skill the candidate GENUINELY has even if the base résumé only mentions it in passing or phrases it differently — a tailored résumé will foreground it. But NEVER credit a core skill the candidate does not actually have; tailoring cannot manufacture real experience and the gap would surface in an interview. A "years of experience" number is a SOFT requirement, not a hard gate — recruiters routinely shortlist strong candidates a couple of years under it; treat a modest years shortfall (~2–3 years) as at most a small deduction, never a disqualifier.
2. ROLE RELEVANCE (0–25): how well the candidate's career trajectory and the kind of work they actually do align with the role's real purpose. This is the irrelevance guard — a role outside the candidate's discipline (e.g. a frontend engineer vs. a mechanical-engineering or sales role) scores near 0 here even if a few keywords overlap. Same-discipline roles in a different industry should still score well; industry vertical matters far less than role type.
3. EXPERIENCE DEPTH & SENIORITY (0–15): can the candidate demonstrably DO this job, given their shown scope and depth? Award full or near-full credit when the candidate meets OR EXCEEDS the level the role needs. Being MORE experienced than the role asks (overqualified) is NOT a negative for getting shortlisted — deduct only a little, and only on a genuine seniority-band collision (e.g. a Principal applying to a true entry-level or internship role). Penalize only CLEAR under-qualification — the candidate plainly lacks the depth and scope the responsibilities demand (not merely a smaller years number than the posting lists).

(Location/remote and comp are NOT scored dimensions — mention any concern in the NOTE. Work-authorization HARD blockers are already handled in Phase 1.)

### USER SCORING GUIDANCE
The candidate context may contain scoring_preferences.scoring_instructions. Follow it for role priorities, industries, trade-offs, and what the user considers worth applying to. It may refine the score within this rubric, but it can NEVER override anti-fabrication, candidate-specific eligibility, the 0–10 scale, or the exact response format.

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

### COMPANY ASSESSMENT (independent annotation — MUST NOT change the SCORE above)
Separately from the fit score, judge the EMPLOYER behind this posting and name the role's core tech.
This section is purely informational: it NEVER raises or lowers the SCORE, sub-scores, or seniority.
Use what you actually KNOW about the company (reputation, size, industry standing) PLUS the posting.
- COMPANY_TIER — rate the employer into exactly one of:
  • good: a well-known, reputable, or clearly established employer (or a reputable staffing firm placing for a real client) hiring genuinely.
  • medium: a plausible real employer or staffing firm, but unremarkable or with limited information.
  • low: a genuine TIME-WASTER you have real reason to distrust — a lead-generation / résumé-upsell / data-harvesting scheme, a vague shell company, a listing that exists mainly to harvest applicant data, or a duplicate/scraped repost of a role that isn't really being hired.
  • unknown: you do not recognize the company and the details are insufficient to judge. DO NOT GUESS — prefer 'unknown' over inventing facts.
  BE CONSERVATIVE — 'low' is only for employers you actually recognize or that show clear scheme signals. When in doubt, use 'medium' or 'unknown', never 'low'.
  DO NOT rate 'low' merely because: the role is CONTRACT / C2C / temporary; a staffing/recruiting firm is hiring for a real client; OR the posting sends you to the employer's OWN external ATS / career-site to create an account and apply (Workday, Greenhouse, iCIMS, Lever, etc.). Requiring a career-site account is completely normal for legitimate employers and is NOT a red flag by itself. Reserve 'low' for schemes whose PURPOSE is to farm data / upsell / drive signups to a third-party service, not for ordinary external application flows.
- TECH_STACK — the primary technologies / frameworks / languages the role centers on, drawn from the posting (e.g. "React, TypeScript, Node.js"). "none" if the posting names no clear stack.

RESPOND IN EXACTLY THIS FORMAT, nothing else:
SCORE: [0-10]
EMPLOYMENT: [full_time|contract|internship|unknown]
SENIORITY: [strong_fit|overqualified|underqualified|unclear]
BREAKDOWN: skills=<0-60> domain=<0-25> experience=<0-15>
KEYWORDS: [comma-separated resume skills that are genuinely relevant to this job]
MISSING: [comma-separated MUST-HAVE requirements the resume does NOT evidence; "none" if all are met]
NOTE: [one concise sentence summarizing the match quality]
REASONING: [3-5 sentences bridging concrete resume facts to the job's must-haves. State the candidate's EVIDENCED years of experience from the resume (or "not specified") and how it compares to any required years — NEVER claim the candidate meets a years/seniority bar the resume does not actually show. State the seniority fit, and remember overqualification is not a penalty for shortlisting.]
COMPANY_TIER: [good|medium|low|unknown]
COMPANY_NOTE: [one concise sentence on the employer's legitimacy; if 'low', name the specific harvesting/lead-gen/scheme signal]
TECH_STACK: [comma-separated primary technologies the role centers on; "none" if unclear]`;

// ── Parsing ──────────────────────────────────────────────────────────────────

const EMPLOYMENT_TYPES: EmploymentType[] = ["full_time", "contract", "internship", "unknown"];
const COMPANY_TIERS: CompanyTier[] = ["good", "medium", "low", "unknown"];

/** Parse a comma-separated tech-stack line into a de-duped list; "none"/empty ⇒ null. */
function parseTechStack(v: string): string[] | null {
  const items = v
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && s.toLowerCase() !== "none");
  const deduped = Array.from(new Set(items));
  return deduped.length ? deduped : null;
}

function parseBreakdown(line: string): ScoreBreakdown | null {
  const get = (k: string): number | null => {
    const m = line.match(new RegExp(`${k}\\s*=\\s*(\\d+)`, "i"));
    return m ? parseInt(m[1], 10) : null;
  };
  const skills = get("skills");
  const experience = get("experience");
  const domain = get("domain");
  if ([skills, experience, domain].every((v) => v === null)) return null;
  const clamp = (v: number | null, max: number) => Math.max(0, Math.min(max, v ?? 0));
  // Three-dimension rubric (ADR 0038): skills 0–60, role/domain 0–25, experience 0–15.
  return {
    skills: clamp(skills, 60),
    domain: clamp(domain, 25),
    experience: clamp(experience, 15),
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
  let company_tier: CompanyTier | null = null;
  let company_tier_note: string | null = null;
  let tech_stack: string[] | null = null;

  for (const raw of response.split("\n")) {
    const line = raw.trim();
    const upper = line.toUpperCase();
    // Each branch keys on an exact line prefix, so COMPANY_TIER / COMPANY_NOTE never
    // collide with SCORE: / NOTE: (a "COMPANY_NOTE:" line does not start with "NOTE:").
    if (line.startsWith("SCORE:")) {
      const m = line.match(/\d+/);
      score = m ? Math.max(0, Math.min(10, parseInt(m[0], 10))) : 0;
    } else if (upper.startsWith("EMPLOYMENT:")) {
      const v = line.slice(11).trim().toLowerCase().replace(/[^a-z_]/g, "");
      if ((EMPLOYMENT_TYPES as string[]).includes(v)) employment_type = v as EmploymentType;
    } else if (upper.startsWith("SENIORITY:")) {
      seniority = line.slice(10).trim() || null;
    } else if (upper.startsWith("BREAKDOWN:")) {
      breakdown = parseBreakdown(line.slice(10));
    } else if (line.startsWith("KEYWORDS:")) {
      keywords = line.replace("KEYWORDS:", "").trim();
    } else if (upper.startsWith("MISSING:")) {
      const v = line.slice(8).trim();
      missing = v && v.toLowerCase() !== "none" ? v : "";
    } else if (upper.startsWith("COMPANY_TIER:")) {
      const v = line.slice(13).trim().toLowerCase().replace(/[^a-z]/g, "");
      company_tier = (COMPANY_TIERS as string[]).includes(v) ? (v as CompanyTier) : "unknown";
    } else if (upper.startsWith("COMPANY_NOTE:")) {
      company_tier_note = line.slice(13).trim() || null;
    } else if (upper.startsWith("TECH_STACK:")) {
      tech_stack = parseTechStack(line.slice(11));
    } else if (line.startsWith("NOTE:")) {
      note = line.replace("NOTE:", "").trim();
    } else if (line.startsWith("REASONING:")) {
      reasoning = line.replace("REASONING:", "").trim();
    }
  }

  return {
    score, keywords, note, reasoning, employment_type, seniority, missing, breakdown,
    company_tier, company_tier_note, tech_stack,
  };
}

/**
 * Build the user message. The description is HTML-stripped BEFORE the 15000-char
 * truncation (ADR 0056): scraped descriptions are stored as HTML, and tags were both
 * burning ~20-40% of the job tokens and pushing real content past the cut.
 *
 * Prompt caching (ADR 0056 → ADR 0066): the system prompt + résumé are identical for
 * every job in a run, so the résumé rides as a SECOND system message carrying the cache
 * breakpoint. Why a system message and not a user segment: in subscription mode the
 * worker's Agent-SDK path folds every system role into its auto-cached `systemPrompt` but
 * FLATTENS user parts (dropping a user-side breakpoint) — so a user-side breakpoint never
 * caches the résumé there. Direct-API Anthropic honours the `cache:true` system part via a
 * `cache_control` block; OpenAI/DeepSeek/Gemini flatten system parts in order, keeping the
 * stable prefix byte-identical for their implicit prefix caching. Only the JOB POSTING
 * tail is new tokens per job. (`resumeText` is the enriched candidate dossier from
 * getScoringCandidateContext — sized to clear Haiku's 4,096-token minimum cacheable prefix.)
 */
export function buildScoreMessages(
  resumeText: string,
  job: ScorableJob,
): ChatMessage[] {
  const description = stripHtml(job.full_description || job.description || "").slice(0, 15000);
  const jobText =
    `TITLE: ${job.title ?? ""}\n` +
    `COMPANY: ${job.company ?? ""}\n` +
    `COMPANY SIZE: ${job.company_size ?? "N/A"}\n` +
    `LOCATION: ${job.location ?? "N/A"}\n\n` +
    `DESCRIPTION:\n${description}`;

  return [
    { role: "system", content: SCORE_PROMPT },
    // Stable prefix (cached across every job in a run).
    { role: "system", content: [{ text: `CANDIDATE CONTEXT:\n${resumeText}\n\n---`, cache: true }] },
    // Volatile tail — the per-job posting, after the cache breakpoint.
    { role: "user", content: [{ text: `JOB POSTING:\n${jobText}` }] },
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
    // Token usage of this call (ADR 0066) — populated by the subscription + Anthropic
    // paths, null otherwise. Lets the UI show cached vs used tokens + cost per score.
    return { ...parseScoreResponse(response), usage: llm.lastUsage ?? null };
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
      company_tier: null,
      company_tier_note: null,
      tech_stack: null,
      usage: null,
    };
  }
}
