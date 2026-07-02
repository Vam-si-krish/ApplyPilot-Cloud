'use client';

import { Gauge } from 'lucide-react';
import type { AtsMatchBreakdown } from '@/lib/types';

/** Color the ATS match % by band (ADR 0053): strong / borderline / weak. */
function tone(score: number): string {
  if (score >= 65) return 'bg-emerald/10 border-emerald/25 text-emerald';
  if (score >= 40) return 'bg-amber-500/10 border-amber-500/25 text-amber-400';
  return 'bg-raised border-ink text-slate-muted';
}

/**
 * Local ATS-style résumé↔job match (ADR 0053) — the first-pass filter, computed
 * with no AI call. Distinct from the AI fit score (1–10) and the actor's
 * skill-match % (🎯).
 */
export default function MatchBadge({
  score,
  breakdown,
  className = '',
}: {
  score: number;
  breakdown?: AtsMatchBreakdown | null;
  className?: string;
}) {
  const missing = (breakdown?.missing ?? []).slice(0, 5).join(', ');
  const flags = (breakdown?.flags ?? []).join('; ');
  const title =
    `ATS match — how an applicant tracking system would rate your résumé for this job` +
    (missing ? `. Missing: ${missing}` : '') +
    (flags ? `. ⚠ ${flags}` : '');
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded border ${tone(score)} ${className}`}
    >
      <Gauge size={10} /> {score}%
    </span>
  );
}
