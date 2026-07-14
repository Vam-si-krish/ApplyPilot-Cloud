import { describe, expect, it } from 'vitest';
import { hasManagedWorker, resolveWorkerConfig } from './workerConfig';

describe('trusted worker configuration', () => {
  it('uses only deployment values in the multi-user fork', () => {
    const config = resolveWorkerConfig(
      { resume_worker_url: 'http://attacker.invalid', resume_worker_secret: 'user-secret' },
      {
        BACKEND_URL: 'https://gateway.example/jobpilot',
        RESUME_WORKER_URL: 'https://gateway.example/jobpilot/worker/',
        RESUME_WORKER_SECRET: 'deployment-secret',
      },
    );
    expect(config).toEqual({
      url: 'https://gateway.example/jobpilot/worker',
      secret: 'deployment-secret',
      managed: true,
    });
  });

  it('fails closed when a managed deployment is missing worker env', () => {
    expect(resolveWorkerConfig(
      { resume_worker_url: 'http://attacker.invalid', resume_worker_secret: 'user-secret' },
      { BACKEND_URL: 'https://gateway.example/jobpilot' },
    )).toBeNull();
  });

  it('preserves the legacy single-owner settings override', () => {
    expect(hasManagedWorker({})).toBe(false);
    expect(resolveWorkerConfig(
      { resume_worker_url: 'https://legacy-worker.example/', resume_worker_secret: 'saved-secret' },
      { RESUME_WORKER_URL: 'https://env-worker.example', RESUME_WORKER_SECRET: 'env-secret' },
    )).toEqual({ url: 'https://legacy-worker.example', secret: 'saved-secret', managed: false });
  });
});
