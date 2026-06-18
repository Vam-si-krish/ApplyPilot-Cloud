import { describe, it, expect } from 'vitest';
import { parseCompanyResponse, buildCompanyMessages, COMPANY_PROMPT } from './companyCheck';

describe('parseCompanyResponse', () => {
  it('parses a well-formed response', () => {
    const r = parseCompanyResponse('TIER: good\nNOTE: Established public company hiring directly.');
    expect(r).toEqual({ tier: 'good', note: 'Established public company hiring directly.' });
  });

  it('maps each valid tier (case/space tolerant)', () => {
    expect(parseCompanyResponse('TIER:  Medium ').tier).toBe('medium');
    expect(parseCompanyResponse('tier: LOW').tier).toBe('low');
    expect(parseCompanyResponse('TIER: unknown').tier).toBe('unknown');
  });

  it('defaults to unknown on a missing or unrecognized TIER', () => {
    expect(parseCompanyResponse('NOTE: no tier line').tier).toBe('unknown');
    expect(parseCompanyResponse('TIER: spammy').tier).toBe('unknown');
    expect(parseCompanyResponse('garbage').tier).toBe('unknown');
  });

  it('trims the note and tolerates missing note', () => {
    expect(parseCompanyResponse('TIER: low\nNOTE:   staffing agency  ').note).toBe('staffing agency');
    expect(parseCompanyResponse('TIER: good').note).toBe('');
  });
});

describe('buildCompanyMessages', () => {
  it('uses COMPANY_PROMPT as system and includes the company facts, stripping HTML', () => {
    const msgs = buildCompanyMessages({
      company: 'Acme',
      company_size: '51-200 employees',
      location: 'NYC',
      title: 'Engineer',
      full_description: '<p>We build <b>things</b></p>',
    });
    expect(msgs[0]).toEqual({ role: 'system', content: COMPANY_PROMPT });
    expect(msgs[1].content).toContain('COMPANY: Acme');
    expect(msgs[1].content).toContain('COMPANY SIZE: 51-200 employees');
    expect(msgs[1].content).toContain('We build things'); // tags stripped
    expect(msgs[1].content).not.toContain('<p>');
  });

  it('falls back to placeholders when fields are missing', () => {
    const msgs = buildCompanyMessages({ company: null, company_size: null, location: null, title: null, full_description: null });
    expect(msgs[1].content).toContain('COMPANY: Unknown');
    expect(msgs[1].content).toContain('COMPANY SIZE: N/A');
  });
});
