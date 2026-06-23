'use client';

/**
 * Fixed, always-visible progress toast for user-initiated bulk jobs (AI fit-scoring
 * and company assessment of the selected jobs). Pinned bottom-right so the user can
 * watch it work in the background while they scroll/keep working — replaces the tiny
 * inline "5/25" status text. Purely presentational; the host drives done/total.
 */
import { Loader2, CheckCircle2 } from 'lucide-react';

export type ProgressTone = 'sky' | 'violet' | 'emerald';

export default function ProgressToast({
  label,
  done,
  total,
  phase,
  tone = 'sky',
}: {
  label: string;
  done: number;
  total: number;
  phase: 'running' | 'done';
  tone?: ProgressTone;
}) {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const barColor = phase === 'done' ? 'bg-emerald' : tone === 'violet' ? 'bg-violet-400' : 'bg-sky';
  return (
    <div className="fixed bottom-5 right-5 z-50 w-80 max-w-[calc(100vw-2.5rem)] bg-card border border-ink rounded-xl shadow-2xl px-4 py-3.5 animate-slide-up">
      <div className="flex items-center gap-2 mb-2">
        {phase === 'done' ? (
          <CheckCircle2 size={15} className="text-emerald shrink-0" />
        ) : (
          <Loader2 size={15} className={`${tone === 'violet' ? 'text-violet-300' : 'text-sky'} animate-spin shrink-0`} />
        )}
        <span className="text-[13px] font-medium text-slate-text flex-1 truncate">{label}</span>
        <span className="text-[12px] font-mono text-slate-muted shrink-0">
          {done}/{total}
        </span>
      </div>
      <div className="h-2 w-full bg-raised rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${barColor}`}
          style={{ width: `${phase === 'done' ? 100 : pct}%` }}
        />
      </div>
    </div>
  );
}
