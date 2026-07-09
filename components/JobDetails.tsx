'use client';

import { CheckCircle2 } from 'lucide-react';
import CompanyTierBadge from '@/components/CompanyTierBadge';
import type { Job } from '@/lib/types';
import { scoreUsageCostUsd } from '@/lib/pricing';

/** Expanded detail panel for a job row — shared so Jobs and Past Jobs render identically. */
export default function JobDetails({ job, onPatch }: { job: Job; onPatch: (id: string, body: Record<string, unknown>) => void }) {
  return (
    <div className="mx-4 sm:mx-6 mb-4 mt-1 space-y-3.5 rounded-xl border border-ink-subtle bg-base/60 px-5 py-4 animate-fade-in">
      {job.status === 'filtered' && (
        <div className="text-[12px] text-amber-400">
          Pre-filtered — {job.prefilter_score}% ATS match (below your threshold), so it skipped LLM scoring.
        </div>
      )}
      {/* ATS-style match breakdown (ADR 0053) — the local first-filter, not the AI fit score. */}
      {job.prefilter_score != null && (
        <div>
          <p className="text-slate-dim text-[10px] font-semibold uppercase tracking-[0.1em] mb-1">
            ATS match · {job.prefilter_score}% (local, no AI)
          </p>
          {job.prefilter_breakdown ? (
            <div className="text-[12px] leading-relaxed space-y-0.5">
              <p className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-mono text-slate-muted">
                {job.prefilter_breakdown.skills != null && (
                  <span>skills <span className="text-slate-text">{job.prefilter_breakdown.skills}</span>/100</span>
                )}
                {job.prefilter_breakdown.title != null && (
                  <span>title <span className="text-slate-text">{job.prefilter_breakdown.title}</span>/100</span>
                )}
                {job.prefilter_breakdown.keywords != null && (
                  <span>keywords <span className="text-slate-text">{job.prefilter_breakdown.keywords}</span>/100</span>
                )}
              </p>
              {(job.prefilter_breakdown.matched.length > 0 || job.prefilter_breakdown.missing.length > 0) && (
                <p>
                  {job.prefilter_breakdown.matched.length > 0 && (
                    <span className="text-emerald">✓ {job.prefilter_breakdown.matched.join(', ')}</span>
                  )}
                  {job.prefilter_breakdown.missing.length > 0 && (
                    <span className="text-slate-muted">
                      {job.prefilter_breakdown.matched.length > 0 ? '  ·  ' : ''}✗ {job.prefilter_breakdown.missing.join(', ')}
                    </span>
                  )}
                </p>
              )}
              {job.prefilter_breakdown.flags.length > 0 && (
                <p className="text-amber-400 text-[11px]">⚠ {job.prefilter_breakdown.flags.join(' · ')}</p>
              )}
            </div>
          ) : (
            <p className="text-[11px] text-slate-muted">
              Scored by the old keyword overlap — hit “Recompute ATS match” on the Jobs tab for the full breakdown.
            </p>
          )}
        </div>
      )}
      {/* Multi-location duplicate group (ADR 0057): same posting, other locations — each
          openable so the user applies to the location they actually want. */}
      {(job.siblings?.length ?? 0) > 0 && (
        <div>
          <p className="text-slate-dim text-[10px] font-semibold uppercase tracking-[0.1em] mb-1">
            Also posted in {job.siblings!.length} other location{job.siblings!.length === 1 ? '' : 's'} · scored once
          </p>
          <div className="flex flex-wrap gap-1.5">
            {job.siblings!.map((s) => (
              <a
                key={s.id}
                href={s.application_url || s.url}
                target="_blank"
                rel="noopener noreferrer"
                title={`Open the ${s.location || 'unknown location'} posting${s.applied_at ? ' (applied)' : ''}`}
                className={`px-2 py-0.5 text-[11px] rounded border transition-colors ${
                  s.applied_at
                    ? 'bg-emerald/10 border-emerald/25 text-emerald'
                    : 'bg-raised border-ink text-slate-text hover:border-sky/40 hover:text-sky'
                }`}
              >
                {s.location || '—'}
                {s.applied_at ? ' ✓' : ''}
              </a>
            ))}
          </div>
        </div>
      )}
      {job.company_tier && (
        <div>
          <p className="text-slate-dim text-[10px] font-semibold uppercase tracking-[0.1em] mb-1">Company rated by AI</p>
          <p className="text-slate-text text-[12px] leading-relaxed">
            <span className="mr-2 align-middle">
              <CompanyTierBadge tier={job.company_tier} />
            </span>
            {job.company_size ? `${job.company_size} · ` : ''}
            {job.company_tier_note}
          </p>
        </div>
      )}
      {(job.tech_stack ?? []).length > 0 && (
        <div>
          <p className="text-slate-dim text-[10px] font-semibold uppercase tracking-[0.1em] mb-1.5">Tech stack</p>
          <div className="flex flex-wrap gap-1.5">
            {job.tech_stack!.map((t) => (
              <span key={t} className="px-1.5 py-0.5 text-[10px] font-medium bg-sky/10 border border-sky/25 text-sky rounded-md">
                {t}
              </span>
            ))}
          </div>
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
          <p className="text-slate-dim text-[10px] font-semibold uppercase tracking-[0.1em] mb-1">
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
          <p className="text-slate-dim text-[10px] font-semibold uppercase tracking-[0.1em] mb-1.5">
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
          <p className="text-slate-dim text-[10px] font-semibold uppercase tracking-[0.1em] mb-1">Matched keywords (AI)</p>
          <p className="text-sky text-[12px] font-mono">{job.score_keywords}</p>
        </div>
      )}
      {job.score_reasoning && (
        <div>
          <p className="text-slate-dim text-[10px] font-semibold uppercase tracking-[0.1em] mb-1">Reasoning</p>
          <p className="text-slate-text text-[12px] leading-relaxed">{job.score_reasoning}</p>
        </div>
      )}
      {/* Scoring token/cache/cost (ADR 0066) — 'cached' tokens are the résumé prefix served
          from cache (~10× cheaper against your subscription window); 0 cached = cache miss.
          The $ is derived from these tokens at the model's rates (ADR 0068) — the subscription
          Agent SDK reports no cost_usd, so we price it ourselves. */}
      {job.score_usage && (
        <p
          className="text-slate-dim text-[11px] font-mono"
          title="Token usage of the scoring call. 'cached' = prompt tokens served from cache (~10× cheaper against your usage window); 0 cached means the résumé prefix didn't hit the cache. The $ is the actual API-equivalent cost, derived from these tokens at the model's published rates (input/output/cache-read/cache-write priced separately)."
        >
          Scored: {fmtTokens(job.score_usage.input_tokens)} in
          {job.score_usage.cache_read_input_tokens > 0
            ? ` (+${fmtTokens(job.score_usage.cache_read_input_tokens)} cached)`
            : ' (0 cached)'}
          {' · '}{fmtTokens(job.score_usage.output_tokens)} out
          {(() => {
            const cost = scoreUsageCostUsd(job.score_usage);
            return cost != null ? ` · ${fmtUsd(cost)}` : '';
          })()}
          {job.score_usage.ms ? ` · ${(job.score_usage.ms / 1000).toFixed(1)}s` : ''}
          {job.score_usage.model ? ` · ${job.score_usage.model}` : ''}
        </p>
      )}
      {job.full_description && (
        <div>
          <p className="text-slate-dim text-[10px] font-semibold uppercase tracking-[0.1em] mb-1">Description</p>
          <div className="text-slate-muted text-[12px] leading-relaxed job-description-html" dangerouslySetInnerHTML={{ __html: job.full_description }} />
        </div>
      )}
    </div>
  );
}

/** Compact token count for the scoring usage line, e.g. 4200 → "4.2k". */
function fmtTokens(n: number | null | undefined): string {
  if (n == null) return '?';
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

/** Per-score USD cost — 4 decimals (scores are sub-cent); tiny non-zero costs floor to "<$0.0001". */
function fmtUsd(n: number): string {
  if (n > 0 && n < 0.0001) return '<$0.0001';
  return `$${n.toFixed(4)}`;
}
