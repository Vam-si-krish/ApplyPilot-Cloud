const MAX_TOOLTIP_NOTE_LENGTH = 240;

/** Keep the collapsed Jobs row compact without discarding its short AI fit explanation. */
export function fitScoreTooltip(score: number | null, note: string | null | undefined): string {
  if (score == null) return 'AI fit score — not scored yet';

  const normalized = note?.replace(/\s+/g, ' ').trim() ?? '';
  const concise =
    normalized.length > MAX_TOOLTIP_NOTE_LENGTH
      ? `${normalized.slice(0, MAX_TOOLTIP_NOTE_LENGTH - 1).trimEnd()}…`
      : normalized;

  return concise
    ? `AI fit score ${score}/10 — ${concise} Expand the row for complete scoring details.`
    : `AI fit score ${score}/10. Expand the row for complete scoring details.`;
}
