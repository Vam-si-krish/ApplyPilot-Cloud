import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resumeToText } from '@/lib/resume';
import type { ResumeDoc } from '@/lib/types';

const db = vi.hoisted(() => ({
  getApplicationWithJob: vi.fn(),
  getScoringResumeText: vi.fn(),
  getSettings: vi.fn(),
  updateApplication: vi.fn(),
}));

vi.mock('@/lib/db', () => db);

import { POST } from '@/app/api/applications/ats-check/route';

const resume: ResumeDoc = {
  basics: { name: 'Taylor Candidate', label: 'Software Engineer', email: '', phone: '', location: '', summary: '' },
  work: [
    {
      name: 'Example',
      position: 'Software Engineer',
      location: '',
      startDate: '2022-01',
      endDate: '',
      highlights: ['Built React and TypeScript applications.'],
    },
  ],
  education: [],
  skills: [{ name: 'Engineering', keywords: ['React', 'TypeScript'] }],
  projects: [],
  customSections: [],
};

function request() {
  return new Request('http://localhost/api/applications/ats-check', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'application-1' }),
  });
}

describe('POST /api/applications/ats-check', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.getApplicationWithJob.mockResolvedValue({
      id: 'application-1',
      tailored_resume: resume,
      job: {
        id: 'job-1',
        title: 'Software Engineer',
        full_description: 'Required: React and TypeScript application development.',
      },
    });
    db.getSettings.mockResolvedValue({ skills: ['React', 'TypeScript'] });
  });

  it('refuses to persist a tailored-only result when the Base résumé is unavailable', async () => {
    db.getScoringResumeText.mockResolvedValue('');

    const response = await POST(request());

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('Base résumé') });
    expect(db.updateApplication).not.toHaveBeenCalled();
  });

  it('persists a complete Base-to-tailored pair even when both scores are equal', async () => {
    db.getScoringResumeText.mockResolvedValue(resumeToText(resume));

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.base.score).toBe(body.tailored.score);
    expect(db.updateApplication).toHaveBeenCalledWith(
      'application-1',
      expect.objectContaining({
        base_match_score: body.base.score,
        tailored_match_score: body.tailored.score,
      }),
    );
  });
});
