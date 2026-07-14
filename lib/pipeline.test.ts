import { describe, expect, it } from 'vitest';
import { appBaseUrl, publicWebhookBaseUrl } from './pipeline';

describe('deployment URL resolution', () => {
  it('ignores the documented Netlify placeholder and uses Netlify URL', () => {
    const env = {
      NEXT_PUBLIC_APP_URL: 'https://your-new-site.netlify.app',
      URL: 'https://applypilot-multi.netlify.app/',
    };
    expect(appBaseUrl(env)).toBe('https://applypilot-multi.netlify.app');
    expect(publicWebhookBaseUrl(env)).toBe('https://applypilot-multi.netlify.app');
  });

  it('normalizes a real configured deployment URL', () => {
    expect(appBaseUrl({ NEXT_PUBLIC_APP_URL: 'https://jobs.example.com/' })).toBe('https://jobs.example.com');
  });

  it('fails closed before an Apify run when only a local callback exists', () => {
    expect(() => publicWebhookBaseUrl({})).toThrow(/real public app URL/i);
  });
});
