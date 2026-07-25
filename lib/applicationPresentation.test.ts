import { describe, expect, it } from 'vitest';
import {
  applicationApplyTypeLabel,
  atsComparisonLabel,
  matchesApplicationApplyType,
  tailoredLocationChip,
} from './applicationPresentation';

describe('Tailor & Apply presentation', () => {
  it('treats unknown actor flags as external, matching the Jobs filter contract', () => {
    expect(matchesApplicationApplyType(true, 'easy')).toBe(true);
    expect(matchesApplicationApplyType(false, 'easy')).toBe(false);
    expect(matchesApplicationApplyType(false, 'external')).toBe(true);
    expect(matchesApplicationApplyType(null, 'external')).toBe(true);
    expect(matchesApplicationApplyType(undefined, 'external')).toBe(true);
    expect(applicationApplyTypeLabel(true)).toBe('Easy Apply');
    expect(applicationApplyTypeLabel(null)).toBe('External Apply');
  });

  it('keeps both ATS values visible even when tailoring does not change the score', () => {
    expect(atsComparisonLabel(61, 74)).toBe('61% → 74%');
    expect(atsComparisonLabel(61, 61)).toBe('61% → 61%');
    expect(atsComparisonLabel(null, 74)).toBe('Base unavailable → 74%');
    expect(atsComparisonLabel(null, null)).toBe('ATS');
  });

  it('shows the location chip only when the tailored header meaningfully differs from home (ADR 0112)', () => {
    expect(tailoredLocationChip('Austin, TX', 'Boston, MA')).toBe('Austin, TX');
    // Same city — case/whitespace differences are not a different location.
    expect(tailoredLocationChip('  boston,  ma ', 'Boston, MA')).toBeNull();
    expect(tailoredLocationChip('Boston, MA', 'Boston, MA')).toBeNull();
    // No tailored résumé / no location / non-string junk → no chip.
    expect(tailoredLocationChip(null, 'Boston, MA')).toBeNull();
    expect(tailoredLocationChip('', 'Boston, MA')).toBeNull();
    expect(tailoredLocationChip(42, 'Boston, MA')).toBeNull();
    // Missing home location still shows a real tailored city.
    expect(tailoredLocationChip('Austin, TX', null)).toBe('Austin, TX');
  });
});
