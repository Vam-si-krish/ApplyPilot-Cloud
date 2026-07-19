/**
 * Eval harness for the per-company assessment (ADR 0101), mirroring evals.test.ts.
 *
 * Every case in evals/company-cases/*.json is a labeled company+posting with the
 * apply-channel verdict(s) we accept and the trust values we forbid. With an LLM
 * key present the whole set runs as ONE live batched call — exactly the shape
 * production uses — and asserts each verdict. Without a key, cases are still
 * structurally validated so a malformed case can't sneak in.
 *
 * The contract to protect (the over-filtering guards): an employer's own external
 * ATS is 'direct', a staffing firm with a real client is 'staffing', and a small
 * unknown startup is never 'suspicious'. Add a case whenever a real-world
 * misclassification is found.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  assessCompanies,
  APPLY_CHANNELS,
  COMPANY_TRUSTS,
  normalizeCompanyKey,
  type CompanyCandidate,
  type CompanyVerdict,
} from '../lib/companyAssessment';

interface CompanyEvalCase {
  name: string;
  description: string;
  company: { name: string; company_size?: string };
  posting: { title: string; description: string };
  expect: { channel: string[]; trustNot?: string[] };
}

const CASES_DIR = join(__dirname, 'company-cases');

function loadCases(): CompanyEvalCase[] {
  return readdirSync(CASES_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(CASES_DIR, f), 'utf-8')) as CompanyEvalCase);
}

const cases = loadCases();
const hasKey = Boolean(
  process.env.GEMINI_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.DEEPSEEK_API_KEY ||
    process.env.ANTHROPIC_API_KEY,
);

describe('company eval cases — structure', () => {
  it('found at least one case', () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  for (const c of cases) {
    it(`${c.name} is well-formed`, () => {
      expect(c.company.name).toBeTruthy();
      expect(c.posting.description).toBeTruthy();
      expect(c.expect.channel.length).toBeGreaterThan(0);
      for (const ch of c.expect.channel) expect(APPLY_CHANNELS).toContain(ch);
      for (const t of c.expect.trustNot ?? []) expect(COMPANY_TRUSTS).toContain(t);
    });
  }
});

describe.skipIf(!hasKey)('company eval cases — live', () => {
  let verdicts: Map<string, CompanyVerdict>;

  it(
    'assesses the whole set in one batched call',
    async () => {
      const candidates: CompanyCandidate[] = cases.map((c) => ({
        company_key: normalizeCompanyKey(c.company.name)!,
        name: c.company.name,
        company_size: c.company.company_size ?? null,
        sample_title: c.posting.title,
        sample_description: c.posting.description,
      }));
      const out = await assessCompanies(candidates);
      verdicts = new Map(out.map((v) => [v.company_key, v]));
      expect(out.length).toBe(cases.length);
    },
    120_000,
  );

  for (const c of cases) {
    it(
      `${c.name}: channel in [${c.expect.channel.join('|')}]${c.expect.trustNot ? `, trust not ${c.expect.trustNot.join('/')}` : ''}`,
      () => {
        const v = verdicts?.get(normalizeCompanyKey(c.company.name)!);
        expect(v, `no verdict returned for ${c.company.name}`).toBeTruthy();
        expect(c.expect.channel, `${c.company.name}: got ${v!.apply_channel} — ${v!.note}`).toContain(v!.apply_channel);
        for (const forbidden of c.expect.trustNot ?? []) {
          expect(v!.trust, `${c.company.name}: trust ${v!.trust} — ${v!.note}`).not.toBe(forbidden);
        }
      },
    );
  }
});
