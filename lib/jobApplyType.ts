/** Group only explicit actor application types for safe enrichment of existing rows. */
export function explicitApplyTypeUrls(
  rows: Array<{ url: string; easy_apply: boolean | null }>,
): { easy: string[]; external: string[] } {
  const easy = new Set<string>();
  const external = new Set<string>();
  for (const row of rows) {
    if (!row.url) continue;
    if (row.easy_apply === true) easy.add(row.url);
    if (row.easy_apply === false) external.add(row.url);
  }
  for (const url of easy) {
    if (external.has(url)) {
      easy.delete(url);
      external.delete(url);
    }
  }
  return { easy: [...easy], external: [...external] };
}
