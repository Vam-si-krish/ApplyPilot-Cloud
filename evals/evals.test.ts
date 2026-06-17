/**
 * Eval harness for the scoring invariant (docs/AI_WORKFLOW.md).
 *
 * Every case in evals/cases/*.json is a labeled resume+job with an expected
 * score band. When an LLM key is present these run live against the real model
 * and assert the score lands in band — this is the regression net for scoring
 * behaviour. Without a key, the live block is skipped but the case files are
 * still structurally validated so a malformed case can't sneak in.
 *
 * Add a new case here whenever a real-world misjudgement is found.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { scoreJob } from '../lib/scoring';
import type { ScorableJob } from '../lib/types';

interface EvalCase {
  name: string;
  description: string;
  resume: string;
  job: ScorableJob;
  expect: { minScore: number; maxScore: number };
}

const CASES_DIR = join(__dirname, 'cases');

function loadCases(): EvalCase[] {
  return readdirSync(CASES_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(CASES_DIR, f), 'utf-8')) as EvalCase);
}

const cases = loadCases();
const hasKey = Boolean(
  process.env.GEMINI_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.DEEPSEEK_API_KEY ||
    process.env.ANTHROPIC_API_KEY,
);

describe('eval cases — structure', () => {
  it('found at least one case', () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  for (const c of cases) {
    it(`${c.name} is well-formed`, () => {
      expect(c.resume).toBeTruthy();
      expect(c.job.full_description).toBeTruthy();
      expect(c.expect.minScore).toBeGreaterThanOrEqual(0);
      expect(c.expect.maxScore).toBeLessThanOrEqual(10);
      expect(c.expect.minScore).toBeLessThanOrEqual(c.expect.maxScore);
    });
  }
});

describe.skipIf(!hasKey)('eval cases — live scoring', () => {
  for (const c of cases) {
    it(
      `${c.name}: score in [${c.expect.minScore}, ${c.expect.maxScore}]`,
      async () => {
        const r = await scoreJob(c.resume, c.job);
        expect(r.score).toBeGreaterThanOrEqual(c.expect.minScore);
        expect(r.score).toBeLessThanOrEqual(c.expect.maxScore);
      },
      120_000,
    );
  }
});
