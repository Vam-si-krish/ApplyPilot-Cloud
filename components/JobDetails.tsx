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
      {job.status !== 'filtered' && job.prefilter_score != null && (
        <p className="text-[11px] text-slate-muted">
          Keyword pre-screen: {job.prefilter_score}% résumé overlap (a rough pre-filter, not the fit score).
        </p>
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
      {job.skill_match_score != null && (
        <div>
          <p className="text-slate-muted text-[10px] uppercase tracking-wider mb-1">
            Skill match · {job.skill_match_score}% of your skills
          </p>
          <p className="text-[12px] leading-relaxed">
            {(job.matched_skills ?? []).length > 0 && (
              <span className="text-emerald">✓ {job.matched_skills!.join(', ')}</span>
            )}
            {(job.unmatched_skills ?? []).length > 0 && (
              <span className="text-slate-muted">
                {(job.matched_skills ?? []).length > 0 ? '  ·  ' : ''}✗ {job.unmatched_skills!.join(', ')}
              </span>
            )}
          </p>
        </div>
      )}
      {/* Weighted-rubric breakdown. Three dimensions (ADR 0038); jobs scored under the
          old five-dimension rubric (ADR 0022) still carry bonus/logistics — render those
          with the old maxes so historical rows stay accurate until re-scored. */}
      {job.score_breakdown && (
        <div>
          <p className="text-slate-muted text-[10px] uppercase tracking-wider mb-1.5">
            Fit breakdown{job.employment_type === 'contract' ? ' · contract role' : ''}
            {job.score_breakdown.seniority ? ` · ${job.score_breakdown.seniority.replace(/_/g, ' ')}` : ''}
          </p>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-mono text-slate-muted mb-1.5">
            {job.score_breakdown.bonus != null || job.score_breakdown.logistics != null ? (
              <>
                <span>skills <span className="text-slate-text">{job.score_breakdown.skills}</span>/40</span>
                <span>experience <span className="text-slate-text">{job.score_breakdown.experience}</span>/25</span>
                <span>domain <span className="text-slate-text">{job.score_breakdown.domain}</span>/20</span>
                <span>bonus <span className="text-slate-text">{job.score_breakdown.bonus}</span>/10</span>
                <span>logistics <span className="text-slate-text">{job.score_breakdown.logistics}</span>/5</span>
              </>
            ) : (
              <>
                <span>skills <span className="text-slate-text">{job.score_breakdown.skills}</span>/60</span>
                <span>role <span className="text-slate-text">{job.score_breakdown.domain}</span>/25</span>
                <span>experience <span className="text-slate-text">{job.score_breakdown.experience}</span>/15</span>
              </>
            )}
          </div>
          {job.score_breakdown.missing && (
            <p className="text-[11px] text-rose">Missing must-haves: <span className="text-slate-text">{job.score_breakdown.missing}</span></p>
          )}
        </div>
      )}
      {job.score_keywords && (
        <div>
          <p className="text-slate-muted text-[10px] uppercase tracking-wider mb-1">Matched keywords (AI)</p>
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
