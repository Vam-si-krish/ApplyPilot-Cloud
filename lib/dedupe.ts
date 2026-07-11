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
 * Stable fingerprint of a posting. AGGRESSIVE by user decision (ADR 0057 addendum):
 * the same company + the same title IS the same requisition — multi-location blasts
 * often vary the body per city (embedded city names, state salary ranges), which made
 * the original body-inclusive hash miss most of them. Applying once per requisition
 * is the point; a company posting genuinely different jobs under one identical title
 * is the rare case and the user accepts merging it.
 *
 * Location is deliberately excluded. The body is used ONLY as a fallback when company
 * or title is missing (never group rows on a half-empty key). Fully empty rows yield
 * null (never grouped).
 */
export function jobContentKey(
  company: string | null | undefined,
  title: string | null | undefined,
  description: string | null | undefined,
): string | null {
  const c = norm(company);
  const t = norm(title);
  if (c && t) return createHash('md5').update(`${c}\n${t}`).digest('hex');
  const d = norm(description);
  if (!c && !t && !d) return null;
  return createHash('md5').update(`${c}\n${t}\n${d}`).digest('hex');
}

/**
 * Split one content-key group into requisition GENERATIONS (ADR 0071, user decision
 * revising ADR 0057's unbounded cross-run linking): a duplicate is a duplicate only
 * WITHIN a single day — the effective grouping is (company, title, UTC date of
 * discovered_at). Same-day multi-location blasts still collapse to one canonical;
 * a repost on any later day is deliberately a fresh posting (scored fresh, surfaces
 * as new), so an old opening and a re-opened one can never merge.
 */
export function partitionByGeneration<T extends { discovered_at: string }>(rows: T[]): T[][] {
  const byDay = new Map<string, T[]>();
  for (const r of rows) {
    const day = r.discovered_at.slice(0, 10);
    const g = byDay.get(day);
    if (g) g.push(r);
    else byDay.set(day, [r]);
  }
  return [...byDay.values()];
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

/** The fields pickCanonical ranks on. */
export interface CanonicalCandidate {
  id: string;
  location: string | null;
  fit_score: number | null;
  discovered_at: string;
}

/**
 * Choose the group's visible representative (ADR 0057 addendum). "Earliest wins" showed
 * whichever metro was scraped first; the user applies from the canonical row, so prefer
 * the variant they'd actually pick: Remote first, then a location from Settings, then a
 * row that's already AI-scored (its score represents the group for free), then earliest.
 */
export function pickCanonical<T extends CanonicalCandidate>(rows: T[], preferredLocations: string[]): T {
  const prefs = preferredLocations.map((p) => p.toLowerCase().trim()).filter(Boolean);
  const locRank = (loc: string | null): number => {
    const l = (loc || '').toLowerCase();
    if (!l) return 0;
    if (l.includes('remote')) return 2;
    return prefs.some((p) => l.includes(p) || p.includes(l)) ? 1 : 0;
  };
  return rows.reduce((best, r) => {
    const a = locRank(r.location) - locRank(best.location);
    if (a !== 0) return a > 0 ? r : best;
    const s = Number(r.fit_score != null) - Number(best.fit_score != null);
    if (s !== 0) return s > 0 ? r : best;
    return r.discovered_at < best.discovered_at ? r : best;
  });
}
