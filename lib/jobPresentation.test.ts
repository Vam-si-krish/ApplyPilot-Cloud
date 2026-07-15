import { describe, expect, it } from 'vitest';
import { fitScoreTooltip } from './jobPresentation';

describe('fitScoreTooltip', () => {
  it('keeps the short fit note available outside the collapsed row layout', () => {
    expect(fitScoreTooltip(8, '  Strong React match\nwith relevant experience. ')).toBe(
      'AI fit score 8/10 — Strong React match with relevant experience. Expand the row for complete scoring details.',
    );
  });

  it('labels unscored jobs and bounds oversized tooltip content', () => {
    expect(fitScoreTooltip(null, 'ignored')).toBe('AI fit score — not scored yet');
    expect(fitScoreTooltip(7, 'x'.repeat(500)).length).toBeLessThan(330);
    expect(fitScoreTooltip(7, 'x'.repeat(500))).toContain('… Expand the row');
  });
});
