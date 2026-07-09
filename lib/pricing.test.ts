import { describe, it, expect } from 'vitest';
import { scoreUsageCostUsd } from './pricing';
import type { ScoreUsage } from './types';

const base: ScoreUsage = {
  input_tokens: 0,
  output_tokens: 0,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
  model: 'claude-haiku-4-5-20251001',
};

describe('scoreUsageCostUsd', () => {
  it('prices a Haiku 4.5 scoring call from its token breakdown', () => {
    // The readout example: 1.2k in (+5.3k cached) · 779 out.
    const usage: ScoreUsage = {
      ...base,
      input_tokens: 1200,
      cache_read_input_tokens: 5300,
      output_tokens: 779,
    };
    // 1200*$1 + 5300*$0.10 + 779*$5, per 1M tokens.
    const expected = (1200 * 1 + 5300 * 0.1 + 779 * 5) / 1_000_000;
    expect(scoreUsageCostUsd(usage)).toBeCloseTo(expected, 10);
    expect(scoreUsageCostUsd(usage)).toBeCloseTo(0.005625, 10);
  });

  it('bills cache writes at the higher (1.25×) rate', () => {
    const usage: ScoreUsage = { ...base, cache_creation_input_tokens: 4096 };
    expect(scoreUsageCostUsd(usage)).toBeCloseTo((4096 * 1.25) / 1_000_000, 12);
  });

  it('ignores the SDK cost_usd when the model is priced (derives from tokens)', () => {
    const usage: ScoreUsage = { ...base, input_tokens: 1000, cost_usd: 999 };
    expect(scoreUsageCostUsd(usage)).toBeCloseTo(0.001, 12);
  });

  it('falls back to SDK cost_usd for an unknown model', () => {
    const usage: ScoreUsage = { ...base, model: 'some-future-model', cost_usd: 0.02 };
    expect(scoreUsageCostUsd(usage)).toBe(0.02);
  });

  it('returns null when it cannot price and there is no reported cost', () => {
    expect(scoreUsageCostUsd({ ...base, model: 'some-future-model' })).toBeNull();
    expect(scoreUsageCostUsd(null)).toBeNull();
  });
});
