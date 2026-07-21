import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const page = readFileSync(fileURLToPath(new URL('../app/onboarding/page.tsx', import.meta.url)), 'utf8');

describe('existing-account onboarding gate', () => {
  it('does not present upload while account status is loading or unavailable', () => {
    expect(page).toContain('statusLoading ?');
    expect(page).toContain('statusError ?');
    expect(page).toContain('Do not upload your résumé again');
    expect(page).toContain('Retry connection');
  });

  it('returns an already-onboarded account directly to the dashboard', () => {
    expect(page).toContain("router.replace('/dashboard')");
    expect(page).toContain('status?.onboarding_complete');
  });
});
