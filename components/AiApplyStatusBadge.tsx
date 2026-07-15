import { Bot } from 'lucide-react';
import type { AiApplyStatus } from '@/lib/types';

const META: Record<AiApplyStatus, { label: string; className: string }> = {
  assigned: { label: 'AI assigned', className: 'border-sky/30 bg-sky/10 text-sky' },
  in_progress: { label: 'AI working', className: 'border-violet-500/30 bg-violet-500/10 text-violet-300' },
  ready_to_submit: { label: 'Finish submit', className: 'border-amber-500/35 bg-amber-500/10 text-amber-400' },
  blocked: { label: 'AI blocked', className: 'border-rose/30 bg-rose/10 text-rose' },
  submitted: { label: 'AI submitted', className: 'border-emerald/30 bg-emerald/10 text-emerald' },
};

export default function AiApplyStatusBadge({ status, reason }: { status: AiApplyStatus; reason?: string | null }) {
  const meta = META[status];
  return (
    <span
      title={reason || meta.label}
      className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${meta.className}`}
    >
      <Bot size={10} /> {meta.label}
    </span>
  );
}
