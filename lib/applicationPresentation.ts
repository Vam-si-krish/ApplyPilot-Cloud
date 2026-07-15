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
