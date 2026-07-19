import type { MailClassification } from './mailClassify';

export const EXTERNAL_MESSAGE_MAX_CHARS = 30_000;

export type ExternalIntakeInput =
  | { ok: true; content: string; timezone: string | null }
  | { ok: false; error: string };

function timezone(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 100) return null;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
    return value;
  } catch {
    return null;
  }
}

export function parseExternalIntakeInput(body: unknown): ExternalIntakeInput {
  if (!body || typeof body !== 'object') return { ok: false, error: 'invalid json' };
  const candidate = body as { content?: unknown; timezone?: unknown };
  const content = typeof candidate.content === 'string' ? candidate.content.trim() : '';
  if (!content) return { ok: false, error: 'Paste the interview or recruiter message first.' };
  if (content.length > EXTERNAL_MESSAGE_MAX_CHARS) {
    return { ok: false, error: `Message must be ${EXTERNAL_MESSAGE_MAX_CHARS.toLocaleString()} characters or less.` };
  }
  return { ok: true, content, timezone: timezone(candidate.timezone) };
}

export function isSavableExternalClassification(result: MailClassification): boolean {
  if (result.category === 'recruiter') return true;
  return result.calendar_action === 'active'
    && Boolean(result.calendar_event_kind)
    && Boolean(result.calendar_start_at || result.calendar_end_at);
}
