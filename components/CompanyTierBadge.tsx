'use client';

import { Building2 } from 'lucide-react';
import type { CompanyTier } from '@/lib/types';

/** Tier styling + plain-English meaning, shared by the row badge, details panel, and legend. */
export const TIER_META: Record<CompanyTier, { label: string; cls: string; help: string }> = {
  good: { label: 'Good', cls: 'bg-emerald/10 border-emerald/25 text-emerald', help: 'Reputable / established employer' },
  medium: { label: 'Medium', cls: 'bg-amber-500/10 border-amber-500/25 text-amber-400', help: 'Plausible employer, limited info' },
  low: { label: 'Low', cls: 'bg-rose/10 border-rose/30 text-rose', help: 'Likely staffing mill, aggregator, or spam — a time-waster' },
  unknown: { label: 'Unknown', cls: 'bg-raised border-ink text-slate-muted', help: 'The AI did not recognize this company' },
};

/**
 * Company-quality badge. The building icon + word + tooltip make it obvious this
 * is an AI rating of the employer (instead of the old cryptic "Good co.").
 */
export default function CompanyTierBadge({
  tier,
  note,
  className = '',
}: {
  tier: CompanyTier;
  note?: string | null;
  className?: string;
}) {
  const m = TIER_META[tier];
  return (
    <span
      title={`Company rated by AI — ${m.label}: ${m.help}${note ? `. ${note}` : ''}`}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded border ${m.cls} ${className}`}
    >
      <Building2 size={10} /> {m.label}
    </span>
  );
}
