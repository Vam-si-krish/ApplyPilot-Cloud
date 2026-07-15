import type { AiApplyStatus, ApplicationWithJob } from './types';

export const AI_APPLY_STATUSES = [
  'assigned',
  'in_progress',
  'ready_to_submit',
  'blocked',
  'submitted',
] as const;

export type AiApplyAction = 'assign' | 'start' | 'ready' | 'block' | 'retry' | 'unassign' | 'submitted';

/** Keeps one copied browser handoff readable; assignment itself is intentionally uncapped. */
export const MAX_AI_NAVIGATION_PROMPT_JOBS = 20;

export const ACTIVE_AI_APPLY_STATUSES: readonly AiApplyStatus[] = [
  'assigned',
  'in_progress',
  'ready_to_submit',
];

export function isActiveAiApplyStatus(status: AiApplyStatus | null | undefined): boolean {
  return status != null && ACTIVE_AI_APPLY_STATUSES.includes(status);
}

function applicationTargetUrl(application: ApplicationWithJob): string | null {
  const raw = application.job?.application_url || application.job?.url;
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

export interface AiApplyReadiness {
  eligible: boolean;
  reason: string;
  targetUrl: string | null;
}

/** Every unapplied Tailor & Apply row with a usable web link can enter the AI queue. */
export function aiApplyReadiness(application: ApplicationWithJob): AiApplyReadiness {
  if (!application.job) return { eligible: false, reason: 'The job was removed.', targetUrl: null };
  if (application.status === 'applied' || application.applied_at) {
    return { eligible: false, reason: 'This application is already marked applied.', targetUrl: null };
  }
  const targetUrl = applicationTargetUrl(application);
  if (!targetUrl) return { eligible: false, reason: 'Add a valid application link before assigning it.', targetUrl: null };
  return { eligible: true, reason: 'Ready to move into the AI application queue.', targetUrl };
}

interface AiApplyTransitionResult {
  ok: boolean;
  error?: string;
  patch?: Record<string, unknown>;
}

/** Pure lifecycle guard used by the API route and regression tests. */
export function resolveAiApplyTransition(
  current: AiApplyStatus | null | undefined,
  action: AiApplyAction,
  now: string,
  reason?: string,
): AiApplyTransitionResult {
  const active = isActiveAiApplyStatus(current);
  switch (action) {
    case 'assign':
      if (current != null) return { ok: false, error: 'Application is already in an AI workflow.' };
      return {
        ok: true,
        patch: {
          ai_apply_status: 'assigned',
          ai_assigned_at: now,
          ai_apply_updated_at: now,
          ai_block_reason: null,
          parked: false,
        },
      };
    case 'start':
      if (current !== 'assigned') return { ok: false, error: 'Only an assigned application can be started.' };
      return { ok: true, patch: { ai_apply_status: 'in_progress', ai_apply_updated_at: now, ai_block_reason: null } };
    case 'ready':
      if (current !== 'in_progress') return { ok: false, error: 'Only an in-progress application can be reviewed.' };
      return { ok: true, patch: { ai_apply_status: 'ready_to_submit', ai_apply_updated_at: now } };
    case 'block': {
      const conciseReason = reason?.replace(/\s+/g, ' ').trim().slice(0, 500) ?? '';
      if (!active) return { ok: false, error: 'Only an active AI application can be blocked.' };
      if (!conciseReason) return { ok: false, error: 'A blocker reason is required.' };
      return {
        ok: true,
        patch: {
          ai_apply_status: 'blocked',
          ai_apply_updated_at: now,
          ai_block_reason: conciseReason,
          parked: true,
        },
      };
    }
    case 'retry':
      if (current !== 'blocked') return { ok: false, error: 'Only a blocked application can be retried.' };
      return {
        ok: true,
        patch: {
          ai_apply_status: 'assigned',
          ai_assigned_at: now,
          ai_apply_updated_at: now,
          ai_block_reason: null,
          parked: false,
        },
      };
    case 'unassign':
      if (current == null || current === 'submitted') return { ok: false, error: 'Application is not in an active AI workflow.' };
      return {
        ok: true,
        patch: {
          ai_apply_status: null,
          ai_assigned_at: null,
          ai_apply_updated_at: null,
          ai_block_reason: null,
          parked: false,
        },
      };
    case 'submitted':
      if (current !== 'in_progress' && current !== 'ready_to_submit') {
        return { ok: false, error: 'Only an application in progress can be recorded as submitted.' };
      }
      return {
        ok: true,
        patch: {
          ai_apply_status: 'submitted',
          ai_apply_updated_at: now,
          ai_block_reason: null,
          parked: false,
          status: 'applied',
          applied_at: now,
        },
      };
  }
}

function safeLine(value: string | null | undefined): string {
  return (value || '—').replace(/[\r\n]+/g, ' ').trim();
}

/** Copyable handoff for the extension-owned autofill + AI navigation workflow. */
export function buildAiNavigationPrompt(
  applications: ApplicationWithJob[],
  maxApplications = MAX_AI_NAVIGATION_PROMPT_JOBS,
): string {
  const boundedMax = Math.max(1, Math.min(maxApplications, MAX_AI_NAVIGATION_PROMPT_JOBS));
  const assigned = applications
    .filter((application) => isActiveAiApplyStatus(application.ai_apply_status))
    .slice(0, boundedMax);
  const queue = assigned.length
    ? assigned
        .map((application, index) => `${index + 1}. ${safeLine(application.job?.title)} — ${safeLine(application.job?.company)} (ApplyPilot ID ${application.id})`)
        .join('\n')
    : 'No active applications are currently assigned.';

  return `Use @Chrome and work from the open ApplyPilot Tailor & Apply → Assign to AI tab. Work through the queue in order and open each next job in a new tab.

Process at most ${boundedMax} applications, one at a time, in this order:
${queue}

For each application:
1. Click Start & open in ApplyPilot. Use the tailored files for that row when they are available.
2. Let my autofill extension fill the page. If one or more fields remain empty, fill only those fields from information already available in my ApplyPilot Candidate Profile, application answers, résumé, or cover letter.
3. Click Next, Continue, Review, or the equivalent button and repeat on every page.
4. If a required answer is not available from those sources, return to ApplyPilot, mark the job Needs review with the missing field in the reason, leave its browser tab open, and continue with the next job in a new tab.
5. On the final page, click Submit. After the site visibly confirms success, mark Submitted in ApplyPilot and continue.

Keep moving quickly. Never invent an answer that is not in my saved information.`;
}
