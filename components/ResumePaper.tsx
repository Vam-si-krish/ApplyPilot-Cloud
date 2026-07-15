import type { ReactNode } from 'react';
import { PencilLine } from 'lucide-react';

/**
 * Shared on-screen résumé page used by the Base résumé editor, tailored editor, and
 * change review. It deliberately mirrors the worker PDF's white, single-column visual
 * hierarchy while leaving rendering/one-page fitting to the worker.
 */
export function ResumePaperFrame({
  children,
  mode = 'edit',
  toolbar,
}: {
  children: ReactNode;
  mode?: 'edit' | 'review';
  toolbar?: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-ink bg-[#080c16] shadow-[0_18px_60px_rgba(0,0,0,0.22)]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.07] px-3.5 py-2.5 sm:px-5">
        <span className="inline-flex items-center gap-2 text-[11px] font-medium text-slate-muted">
          {mode === 'edit' ? <PencilLine size={13} className="text-sky" /> : null}
          {mode === 'edit' ? 'Document editor · click any text to make changes' : 'Tailored document · changes highlighted in context'}
        </span>
        {toolbar}
      </div>
      <div className="overflow-x-auto bg-[#111827] p-2.5 sm:p-5 lg:p-7">
        <div className="mx-auto min-h-[720px] w-full max-w-[816px] bg-white px-5 py-7 font-sans text-[#1a1a1a] shadow-[0_8px_28px_rgba(0,0,0,0.38)] ring-1 ring-black/10 sm:px-10 sm:py-10 lg:px-[52px] lg:py-[48px]">
          {children}
        </div>
      </div>
    </div>
  );
}

/** Section rule and typography mirror `resume-worker/templates.js`. */
export function ResumeSectionHeading({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="mb-2 mt-5 flex items-center gap-2 border-b border-[#1a1a1a] pb-0.5 first:mt-0">
      <h2 className="text-[13px] font-bold uppercase tracking-[0.055em] text-[#1a1a1a] sm:text-[14px]">{title}</h2>
      {action ? <div className="ml-auto print:hidden">{action}</div> : null}
    </div>
  );
}
