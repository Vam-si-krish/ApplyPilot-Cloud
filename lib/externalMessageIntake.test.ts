import { describe, expect, it } from 'vitest';
import { isSavableExternalClassification, parseExternalIntakeInput } from './externalMessageIntake';
import { parseMailResponse } from './mailClassify';

describe('external message intake boundary', () => {
  it('trims content, accepts an IANA timezone, and rejects empty or oversized pastes', () => {
    expect(parseExternalIntakeInput({ content: '  interview text  ', timezone: 'America/New_York' })).toEqual({
      ok: true,
      content: 'interview text',
      timezone: 'America/New_York',
    });
    expect(parseExternalIntakeInput({ content: ' ', timezone: 'UTC' }).ok).toBe(false);
    expect(parseExternalIntakeInput({ content: 'x'.repeat(30_001), timezone: 'UTC' }).ok).toBe(false);
    expect(parseExternalIntakeInput({ content: 'message', timezone: 'not/a-zone' })).toEqual({
      ok: true,
      content: 'message',
      timezone: null,
    });
  });

  it('saves recruiter follow-ups and grounded active events, but not unrelated or completion-only text', () => {
    expect(isSavableExternalClassification(parseMailResponse('CATEGORY: recruiter\nSUMMARY: Reply to recruiter.'))).toBe(true);
    expect(isSavableExternalClassification(parseMailResponse('CATEGORY: shortlisted\nEVENT_TYPE: interview\nEVENT_ACTION: active\nEVENT_START: 2026-08-01T10:00:00-04:00'))).toBe(true);
    expect(isSavableExternalClassification(parseMailResponse('CATEGORY: other\nSUMMARY: Newsletter'))).toBe(false);
    expect(isSavableExternalClassification(parseMailResponse('CATEGORY: other\nEVENT_TYPE: interview\nEVENT_ACTION: complete'))).toBe(false);
  });
});
