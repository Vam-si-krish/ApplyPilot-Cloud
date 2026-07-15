import { describe, expect, it } from 'vitest';
import { explicitApplyTypeUrls } from './jobApplyType';

describe('explicitApplyTypeUrls', () => {
  it('groups explicit values, deduplicates URLs, and leaves unknown rows alone', () => {
    expect(explicitApplyTypeUrls([
      { url: 'easy', easy_apply: true },
      { url: 'easy', easy_apply: true },
      { url: 'external', easy_apply: false },
      { url: 'unknown', easy_apply: null },
      { url: 'conflict', easy_apply: true },
      { url: 'conflict', easy_apply: false },
    ])).toEqual({ easy: ['easy'], external: ['external'] });
  });
});
