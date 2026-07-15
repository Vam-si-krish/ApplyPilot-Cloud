import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const route = readFileSync(
  fileURLToPath(new URL('../app/api/applications/[id]/ai-assignment/route.ts', import.meta.url)),
  'utf8',
);
const db = readFileSync(fileURLToPath(new URL('./db.ts', import.meta.url)), 'utf8');
const migration = readFileSync(
  fileURLToPath(new URL('../supabase/migrations/0050_application_ai_assignment.sql', import.meta.url)),
  'utf8',
);
const applicationsPage = readFileSync(
  fileURLToPath(new URL('../app/(app)/applications/page.tsx', import.meta.url)),
  'utf8',
);

describe('AI assignment persistence boundary', () => {
  it('keeps AI lifecycle fields in the slim user-scoped application projection', () => {
    for (const field of ['ai_apply_status', 'ai_assigned_at', 'ai_apply_updated_at', 'ai_block_reason']) {
      expect(db).toContain(field);
    }
  });

  it('uses a dedicated guarded route and syncs a verified submission to the job', () => {
    expect(route).toContain("const ACTIONS: AiApplyAction[]");
    expect(route).toContain("action === 'assign' || action === 'retry'");
    expect(route).toContain("action === 'submitted'");
    expect(route).not.toContain('body.confirmed');
    expect(route).not.toContain('MAX_AI_APPLY_BATCH');
    expect(route).not.toContain("count: 'exact'");
    expect(route).toContain(".from('jobs')");
    expect(route).toContain('applied_at: updated.applied_at');
  });

  it('constrains lifecycle values and indexes them inside the existing RLS-owned table', () => {
    expect(migration).toContain('applications_ai_apply_status_check');
    expect(migration).toContain("'ready_to_submit'");
    expect(migration).toContain('applications_user_ai_apply_idx');
    expect(migration).toContain('applications_ai_apply_parking_check');
    expect(migration).toContain('applications_ai_block_reason_length_check');
    expect(migration).not.toMatch(/create policy|disable row level security/i);
  });

  it('keeps the navigation controls in a stable row slot and exposes blocker recovery', () => {
    expect(applicationsPage).toContain("{ id: 'ai' as View, label: 'Assign to AI' }");
    expect(applicationsPage).toContain('w-[190px] shrink-0');
    expect(applicationsPage).toContain("updateAiApplication(a, 'block')");
    expect(applicationsPage).toContain("updateAiApplication(a, 'retry')");
    expect(applicationsPage).toContain('<AiApplyStatusBadge');
    expect(applicationsPage).toContain('Needs review');
    expect(applicationsPage).not.toContain('MAX_AI_APPLY_BATCH');
    expect(applicationsPage).not.toContain('Ready for review');
  });
});
