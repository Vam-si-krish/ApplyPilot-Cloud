'use client';

import { CheckCircle2 } from 'lucide-react';
import CompanyTierBadge from '@/components/CompanyTierBadge';
import type { Job } from '@/lib/types';

/** Expanded detail panel for a job row — shared so Jobs and Past Jobs render identically. */
export default function JobDetails({ job, onPatch }: { job: Job; onPatch: (id: string, body: Record<string, unknown>) => void }) {
  return (
    <div className="px-14 pb-5 pt-1 space-y-3 bg-base/40">
      {job.status === 'filtered' && (
        <div className="text-[12px] text-amber-400">
          Pre-filtered — {job.prefilter_score}% résumé match (below your threshold), so it skipped LLM scoring.
        </div>
      )}
      {job.company_tier && (
        <div>
          <p className="text-slate-muted text-[10px] uppercase tracking-wider mb-1">Company rated by AI</p>
          <p className="text-slate-text text-[12px] leading-relaxed">
            <span className="mr-2 align-middle">
              <CompanyTierBadge tier={job.company_tier} />
            </span>
            {job.company_size ? `${job.company_size} · ` : ''}
            {job.company_tier_note}
          </p>
        </div>
      )}
      {job.applied_at && (
        <div className="flex items-center gap-2 text-emerald text-[12px]">
          <CheckCircle2 size={13} />
          Applied {new Date(job.applied_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          <button onClick={() => onPatch(job.id, { applied_at: null })} className="text-slate-muted hover:text-rose text-[11px] ml-1 underline">
            undo
          </button>
        </div>
      )}
      {job.score_keywords && (
        <div>
          <p className="text-slate-muted text-[10px] uppercase tracking-wider mb-1">Matched keywords</p>
          <p className="text-sky text-[12px] font-mono">{job.score_keywords}</p>
        </div>
      )}
      {job.score_reasoning && (
        <div>
          <p className="text-slate-muted text-[10px] uppercase tracking-wider mb-1">Reasoning</p>
          <p className="text-slate-text text-[12px] leading-relaxed">{job.score_reasoning}</p>
        </div>
      )}
      {job.full_description && (
        <div>
          <p className="text-slate-muted text-[10px] uppercase tracking-wider mb-1">Description</p>
          <div className="text-slate-muted text-[12px] leading-relaxed job-description-html" dangerouslySetInnerHTML={{ __html: job.full_description }} />
        </div>
      )}
    </div>
  );
}
