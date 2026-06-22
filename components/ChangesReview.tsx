'use client';

import { AlertTriangle } from 'lucide-react';
import type { TailorChanges } from '@/lib/types';

/**
 * Shows what the AI added/embellished beyond the base résumé (ADR 0026) so the user
 * reviews before using it. Verifiable facts (employers/titles/dates/education) are
 * never changed — this lists added skills and invented/embellished points only.
 */
export function hasChanges(c?: TailorChanges | null): boolean {
  return !!c && ((c.addedSkills?.length ?? 0) > 0 || (c.notes?.length ?? 0) > 0);
}

/** Confirm dialog before download/use; returns true when there's nothing to flag or the user accepts. */
export function confirmTailorChanges(c?: TailorChanges | null): boolean {
  if (!hasChanges(c)) return true;
  const lines: string[] = [];
  if (c!.addedSkills?.length) lines.push('Added skills: ' + c!.addedSkills.join(', '));
  if (c!.notes?.length) lines.push('', 'Embellished / invented:', ...c!.notes.map((n) => '• ' + n));
  return window.confirm(
    'The AI added or embellished the following beyond your base résumé. Make sure you can speak to all of it in an interview.\n\n' +
      lines.join('\n') +
      '\n\nDownload anyway?',
  );
}

export default function ChangesReview({ changes }: { changes?: TailorChanges | null }) {
  if (!hasChanges(changes)) return null;
  const c = changes!;
  return (
    <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-2">
        <AlertTriangle size={15} className="text-amber-400 shrink-0" />
        <p className="text-[13px] font-medium text-amber-300">Review what the AI added</p>
      </div>
      <p className="text-[11px] text-amber-200/70 mb-3">
        Your employers, titles, dates, and education are unchanged. These additions go beyond your base résumé — only keep what
        you can back up in an interview.
      </p>
      {c.addedSkills.length > 0 && (
        <div className="mb-2">
          <p className="text-[11px] text-amber-200/80 uppercase tracking-wider font-medium mb-1.5">Added skills</p>
          <div className="flex flex-wrap gap-1.5">
            {c.addedSkills.map((s) => (
              <span key={s} className="px-2 py-0.5 text-[11px] bg-amber-500/15 border border-amber-500/30 text-amber-200 rounded">
                {s}
              </span>
            ))}
          </div>
        </div>
      )}
      {c.notes.length > 0 && (
        <div>
          <p className="text-[11px] text-amber-200/80 uppercase tracking-wider font-medium mb-1">Embellished / invented points</p>
          <ul className="list-disc pl-4 space-y-0.5">
            {c.notes.map((n, i) => (
              <li key={i} className="text-[12px] text-amber-100/90">
                {n}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
