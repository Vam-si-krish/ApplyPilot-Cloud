import test from 'node:test';
import assert from 'node:assert/strict';
import { buildScoreMessages, parseScoreResponse, SCORE_PROMPT } from './scoring.js';

test('subscription scoring preserves the numeric score and company annotations', () => {
  const result = parseScoreResponse(`SCORE: 8
EMPLOYMENT: full_time
SENIORITY: strong_fit
BREAKDOWN: skills=51 domain=22 experience=13
KEYWORDS: TypeScript, React
MISSING: none
NOTE: Strong match.
REASONING: The resume demonstrates the core requirements.
COMPANY_TIER: good
COMPANY_NOTE: Established employer.
TECH_STACK: React, TypeScript, React`);

  assert.equal(result.score, 8);
  assert.equal(result.company_tier, 'good');
  assert.equal(result.company_tier_note, 'Established employer.');
  assert.deepEqual(result.tech_stack, ['React', 'TypeScript']);
});

test('subscription scorer is owner-neutral and receives the caller dossier', () => {
  assert.doesNotMatch(SCORE_PROMPT, /candidate is on F1|they are, on OPT|will need H-1B/i);
  const messages = buildScoreMessages('Candidate A\n{"require_sponsorship":false}', {
    title: 'Engineer', company: 'Example', full_description: 'Build software.',
  });
  assert.match(messages[1].content[0].text, /CANDIDATE CONTEXT:\nCandidate A/);
  assert.match(messages[1].content[0].text, /"require_sponsorship":false/);
});
