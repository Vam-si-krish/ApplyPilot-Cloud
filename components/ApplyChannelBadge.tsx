'use client';

import { Building2, ShieldAlert } from 'lucide-react';
import type { ApplyChannel, CompanyTrust } from '@/lib/types';

/** Channel styling + plain-English meaning, shared by the row badge, details panel,
 *  and filter labels (ADR 0107). The rose ones are the time-waster set. */
export const CHANNEL_META: Record<ApplyChannel, { label: string; cls: string; help: string }> = {
  direct: {
    label: 'Direct',
    cls: 'bg-emerald/10 border-emerald/25 text-emerald',
    help: 'Posted by the hiring employer itself',
  },
  staffing: {
    label: 'Staffing',
    cls: 'bg-sky/10 border-sky/25 text-sky',
    help: 'Recruiter/agency hiring for a real client',
  },
  aggregator: {
    label: 'Aggregator',
    cls: 'bg-rose/10 border-rose/30 text-rose',
    help: 'Third-party repost behind its own signup — the real opening lives elsewhere',
  },
  talent_marketplace: {
    label: 'Talent pool',
    cls: 'bg-rose/10 border-rose/30 text-rose',
    help: 'Applying joins their vetted talent pool, not this specific role',
  },
  gig_platform: {
    label: 'Gig platform',
    cls: 'bg-rose/10 border-rose/30 text-rose',
    help: 'Task-work platform (labeling/AI training), not a traditional job',
  },
  unknown: {
    label: 'Unknown',
    cls: 'bg-raised border-ink text-slate-muted',
    help: 'The AI could not tell who receives the application',
  },
};

/**
 * Per-company apply-channel badge (ADR 0107) — supersedes CompanyTierBadge on rows
 * whose company has been assessed. A suspicious-trust company renders as a red
 * "Suspicious" badge regardless of channel: that verdict outranks everything.
 */
export default function ApplyChannelBadge({
  channel,
  trust,
  note,
  className = '',
}: {
  channel: ApplyChannel;
  trust?: CompanyTrust | null;
  note?: string | null;
  className?: string;
}) {
  const suspicious = trust === 'suspicious';
  const m = CHANNEL_META[channel];
  const label = suspicious ? 'Suspicious' : m.label;
  const help = suspicious ? 'Concrete scheme signals — do not spend time here' : m.help;
  const cls = suspicious ? 'bg-rose/15 border-rose/40 text-rose' : m.cls;
  const Icon = suspicious ? ShieldAlert : Building2;
  return (
    <span
      title={`Company assessed by AI — ${label}: ${help}${note ? `. ${note}` : ''}`}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded-md border ${cls} ${className}`}
    >
      <Icon size={10} /> {label}
    </span>
  );
}
