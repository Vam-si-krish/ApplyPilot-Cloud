import { describe, it, expect } from 'vitest';
import {
  buildAssessMessages,
  collectCandidates,
  normalizeCompanyKey,
  parseAssessResponse,
  TIME_WASTER_CHANNELS,
  type CompanyCandidate,
} from './companyAssessment';

const candidates: CompanyCandidate[] = [
  { company_key: 'dataannotation', name: 'DataAnnotation', company_size: '51-200 employees', sample_title: 'Software Engineer - AI Trainer', sample_description: 'Train AI models…' },
  { company_key: 'acme corp', name: 'Acme Corp', sample_title: 'Senior Frontend Engineer', sample_description: '<p>We are hiring…</p>' },
  { company_key: 'jobgether', name: 'Jobgether', sample_title: 'Backend Engineer', sample_description: 'On behalf of a partner company…' },
];

describe('normalizeCompanyKey', () => {
  it('lowercases, trims, and collapses whitespace (lockstep with the SQL backfill)', () => {
    expect(normalizeCompanyKey('  Jack   &  Jill \n')).toBe('jack & jill');
    expect(normalizeCompanyKey('DataAnnotation')).toBe('dataannotation');
  });

  it('returns null for empty/blank/missing names', () => {
    expect(normalizeCompanyKey('')).toBeNull();
    expect(normalizeCompanyKey('   ')).toBeNull();
    expect(normalizeCompanyKey(null)).toBeNull();
    expect(normalizeCompanyKey(undefined)).toBeNull();
  });
});

describe('buildAssessMessages', () => {
  it('numbers every company and strips description HTML', () => {
    const [system, user] = buildAssessMessages(candidates);
    expect(system.role).toBe('system');
    const text = typeof user.content === 'string' ? user.content : '';
    expect(text).toContain('COMPANY 1');
    expect(text).toContain('NAME: Jobgether');
    expect(text).toContain('COMPANY 3');
    expect(text).not.toContain('<p>');
  });
});

describe('parseAssessResponse', () => {
  it('parses a well-formed batch', () => {
    const r = parseAssessResponse(
      [
        'COMPANY 1',
        'APPLY_CHANNEL: gig_platform',
        'TRUST: established',
        'NOTE: Task-work platform recruiting for AI-training piecework.',
        'COMPANY 2',
        'APPLY_CHANNEL: direct',
        'TRUST: plausible',
        'NOTE: Appears to be the hiring employer itself.',
        'COMPANY 3',
        'APPLY_CHANNEL: aggregator',
        'TRUST: plausible',
        'NOTE: Reposts partner-company roles behind its own signup.',
      ].join('\n'),
      candidates,
    );
    expect(r).toHaveLength(3);
    expect(r[0]).toMatchObject({ company_key: 'dataannotation', apply_channel: 'gig_platform', trust: 'established' });
    expect(r[1]).toMatchObject({ company_key: 'acme corp', apply_channel: 'direct' });
    expect(r[2].note).toContain('signup');
  });

  it('falls back to unknown on invalid enum values, never fabricating a category', () => {
    const r = parseAssessResponse(
      'COMPANY 1\nAPPLY_CHANNEL: pyramid_scheme\nTRUST: terrible\nNOTE: x',
      candidates,
    );
    expect(r).toHaveLength(1);
    expect(r[0].apply_channel).toBe('unknown');
    expect(r[0].trust).toBe('unknown');
  });

  it('skips companies whose block is missing or mangled (they stay unassessed)', () => {
    const r = parseAssessResponse(
      'COMPANY 1\nAPPLY_CHANNEL: direct\nTRUST: plausible\nCOMPANY 2\nTRUST: plausible',
      candidates,
    );
    expect(r).toHaveLength(1);
    expect(r[0].company_key).toBe('dataannotation');
  });

  it('ignores out-of-range company indexes and garbage lines', () => {
    const r = parseAssessResponse(
      'preamble\nCOMPANY 9\nAPPLY_CHANNEL: direct\nCOMPANY 2\napply_channel: Staffing\ntrust: Established\nnote: ok',
      candidates,
    );
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ company_key: 'acme corp', apply_channel: 'staffing', trust: 'established' });
  });

  it('returns empty for an empty/garbled response', () => {
    expect(parseAssessResponse('', candidates)).toHaveLength(0);
    expect(parseAssessResponse('sorry, I cannot help with that', candidates)).toHaveLength(0);
  });
});

describe('collectCandidates', () => {
  it('dedupes by normalized key and keeps the first row as the sample', () => {
    const out = collectCandidates([
      { company: ' Acme  Corp ', company_size: '11-50', title: 'A', full_description: 'first' },
      { company: 'acme corp', company_size: null, title: 'B', full_description: 'second' },
      { company: null, company_size: null, title: 'C', full_description: 'no company' },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ company_key: 'acme corp', name: 'Acme  Corp'.trim(), sample_description: 'first' });
  });
});

describe('time-waster set', () => {
  it('is exactly the three intermediary channels (direct/staffing/unknown stay visible)', () => {
    expect([...TIME_WASTER_CHANNELS].sort()).toEqual(['aggregator', 'gig_platform', 'talent_marketplace']);
  });
});
