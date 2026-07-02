/**
 * Duplicate-posting detection (ADR 0057). Employers blast one requisition across
 * many locations (Deloitte × 12 metros) and re-post daily under fresh LinkedIn job
 * ids — same company, same title, byte-identical description, different URL. URL
 * de-duplication (the jobs table's unique key) can't catch those; measured on the
 * live DB they were ~32% of all rows and 561 wasted LLM scoring calls.
 *
 * `jobContentKey` fingerprints WHAT the posting is (company + title + HTML-stripped,
 * whitespace-collapsed, lowercased description) rather than WHERE it points. Rows
 * sharing a key are the same posting; the first-seen row is the canonical and the
 * rest link to it via jobs.duplicate_of. The ONE canonical implementation lives
 * here — ingestion, the scoring loop, and the backfill all import it, so keys stay
 * comparable across runs.
 */
import { createHash } from 'node:crypto';
import { stripHtml } from './prefilter';

/** Normalize a field the way reposts vary: case, whitespace, HTML. */
function norm(s: string | null | undefined): string {
  return stripHtml(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Stable fingerprint of a posting's content. Location is deliberately EXCLUDED —
 * that's the field multi-location reposts vary. Empty company+title+description
 * yields null (never group unrelated empty rows).
 */
export function jobContentKey(
  company: string | null | undefined,
  title: string | null | undefined,
  description: string | null | undefined,
): string | null {
  const parts = [norm(company), norm(title), norm(description)];
  if (parts.every((p) => !p)) return null;
  return createHash('md5').update(parts.join('\n')).digest('hex');
}

/** The score fields copied verbatim from a canonical row to its duplicates —
 *  identical content ⇒ identical score; the rubric does not score location. */
export const COPYABLE_SCORE_FIELDS = [
  'fit_score',
  'score_note',
  'score_keywords',
  'score_reasoning',
  'score_breakdown',
  'employment_type',
] as const;
