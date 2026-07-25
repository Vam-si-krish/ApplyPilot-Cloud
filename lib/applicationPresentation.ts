export type ApplicationApplyTypeFilter = 'all' | 'easy' | 'external';

/** Keep Tailor & Apply's apply-type semantics aligned with the Jobs workspace (ADR 0078). */
export function matchesApplicationApplyType(
  easyApply: boolean | null | undefined,
  filter: ApplicationApplyTypeFilter,
): boolean {
  if (filter === 'easy') return easyApply === true;
  if (filter === 'external') return easyApply !== true;
  return true;
}

export function applicationApplyTypeLabel(easyApply: boolean | null | undefined): string {
  return easyApply === true ? 'Easy Apply' : 'External Apply';
}

/** A completed tailored ATS result always keeps the before and after values visible. */
export function atsComparisonLabel(base: number | null, tailored: number | null): string {
  if (tailored == null) return 'ATS';
  return base == null ? `Base unavailable → ${tailored}%` : `${base}% → ${tailored}%`;
}

/**
 * The location a row's copy-for-forms chip should show (ADR 0112): the tailored
 * résumé's header location, but only when it MEANINGFULLY differs from the home
 * location — same-city résumés (the common case) get no chip. Whitespace and case
 * differences don't count as a different city.
 */
export function tailoredLocationChip(tailored: unknown, home: unknown): string | null {
  const norm = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
  const t = norm(tailored);
  if (!t || t.toLowerCase() === norm(home).toLowerCase()) return null;
  return t;
}
