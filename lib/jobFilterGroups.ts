/**
 * When a hidden canonical job has visible duplicate locations, keep the group visible by
 * promoting one duplicate to representative. The API later attaches the other visible
 * locations as siblings of that representative.
 */
export function promoteVisibleDuplicateGroups<T extends { id: string; duplicate_of: string | null }>(
  rows: T[],
  hiddenCanonicalIds: ReadonlySet<string>,
): {
  rows: T[];
  canonicalGroupByRepresentative: Map<string, string>;
  collapsedCount: number;
} {
  const promotedGroups = new Set<string>();
  const canonicalGroupByRepresentative = new Map<string, string>();
  const visible: T[] = [];

  for (const row of rows) {
    const canonicalId = row.duplicate_of;
    if (!canonicalId || !hiddenCanonicalIds.has(canonicalId)) {
      visible.push(row);
      continue;
    }

    if (promotedGroups.has(canonicalId)) continue;
    promotedGroups.add(canonicalId);
    canonicalGroupByRepresentative.set(row.id, canonicalId);
    visible.push({ ...row, duplicate_of: null });
  }

  return {
    rows: visible,
    canonicalGroupByRepresentative,
    collapsedCount: rows.length - visible.length,
  };
}

export function duplicatePassesHideFilters(
  row: { id: string; applied_at: string | null },
  options: {
    excludeApplied: boolean;
    excludeInApplications: boolean;
    applicationJobIds: ReadonlySet<string>;
  },
): boolean {
  if (options.excludeApplied && row.applied_at) return false;
  if (options.excludeInApplications && options.applicationJobIds.has(row.id)) return false;
  return true;
}
