/**
 * Job fit scoring — LLM-powered evaluation of candidate-job match quality.
 *
 * Direct port of ../ApplyPilot-Lite/src/applypilot/scoring/scorer.py. The
 * SCORE_PROMPT, user-message construction (description truncated to 6000 chars),
 * temperature/max_tokens, and the SCORE/KEYWORDS/NOTE/REASONING parser are kept
 * byte-for-byte faithful — this is the project invariant (see CLAUDE.md).
 */

import { getClient, ChatMessage } from './llm';
import type { ScorableJob, ScoreResult } from './types';

// ── Scoring Prompt (copied verbatim from scorer.py) ──────────────────────────

export const SCORE_PROMPT = `You are an expert Talent Acquisition Strategist. Your goal is to semantically analyze the match between a Candidate's Resume and a Job Posting.

### PHASE 1: CONTENT VALIDATION
First, inspect the "JOB POSTING" text.
- If the text is NOT a job description (e.g., it is a legal disclaimer, accessibility statement, login screen, list of navigation links, or generic footer), you MUST set SCORE to 0 and stop.
- Otherwise, proceed to Phase 2.

### PHASE 2: ALIGNMENT ANALYSIS
Evaluate the candidate's fitness for the role using these weighted dimensions:
1. CORE CAPABILITIES: Match technical and functional skills based on intent and application, not just literal keywords.
2. SENIORITY & SCOPE: Compare the level of responsibility (e.g., Junior vs Senior) and the scale of previous work.
3. ROLE ALIGNMENT: How well does the candidate's career trajectory align with the role's purpose?

### SCORING RUBRIC
- 9-10: Exceptional fit. Resume directly demonstrates mastery of the primary requirements.
- 7-8: Strong fit. Demonstrates necessary skills and relevant experience; minor gaps are acceptable.
- 5-6: Moderate fit. Possesses baseline skills but lacks experience in key domain areas.
- 3-4: Weak fit. Significant mismatch in skills, seniority, or industry.
- 1-2: Non-match. Unrelated professional background.
- 0: INVALID CONTENT. The input text is not a job description.

RESPOND IN EXACTLY THIS FORMAT:
SCORE: [0-10]
KEYWORDS: [comma-separated skills from the resume that are relevant to this job]
NOTE: [one concise sentence summarizing the match quality]
REASONING: [2-3 sentences providing a logical bridge between the resume facts and job requirements]`;

/**
 * Parse the LLM response into structured fields. Identical semantics to
 * _parse_score_response in scorer.py: line-prefixed SCORE/KEYWORDS/NOTE/REASONING,
 * score clamped to 0–10, 0 = invalid content / not a real job description.
 */
export function parseScoreResponse(response: string): ScoreResult {
  let score = 0;
  let keywords = '';
  let note = '';
  let reasoning = response;

  for (const raw of response.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('SCORE:')) {
      const m = line.match(/\d+/);
      if (m) {
        const n = parseInt(m[0], 10);
        score = Math.max(0, Math.min(10, n)); // 0 = invalid content, keep it
      } else {
        score = 0;
      }
    } else if (line.startsWith('KEYWORDS:')) {
      keywords = line.replace('KEYWORDS:', '').trim();
    } else if (line.startsWith('NOTE:')) {
      note = line.replace('NOTE:', '').trim();
    } else if (line.startsWith('REASONING:')) {
      reasoning = line.replace('REASONING:', '').trim();
    }
  }

  return { score, keywords, note, reasoning };
}

/** Build the exact user message scorer.py sends (description truncated to 6000 chars). */
export function buildScoreMessages(resumeText: string, job: ScorableJob): ChatMessage[] {
  const description = (job.full_description || job.description || '').slice(0, 6000);
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

/**
 * Score a single job against the resume. One LLM call (temperature 0.2,
 * max_tokens 512). On any LLM error returns score 0 (visible failure, never a
 * fabricated score) — same as scorer.py.
 */
export async function scoreJob(resumeText: string, job: ScorableJob): Promise<ScoreResult> {
  const messages = buildScoreMessages(resumeText, job);
  try {
    const client = getClient();
    const response = await client.chat(messages, { maxTokens: 512, temperature: 0.2 });
    return parseScoreResponse(response);
  } catch (e) {
    return { score: 0, keywords: '', note: '', reasoning: `LLM error: ${e instanceof Error ? e.message : String(e)}` };
  }
}
