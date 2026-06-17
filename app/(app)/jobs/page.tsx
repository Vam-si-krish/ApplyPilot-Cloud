'use client';

import { useCallback, useEffect, useState } from 'react';
import { Star, ExternalLink, ChevronDown, ChevronRight, Archive, Search } from 'lucide-react';
import ScoreBadge from '@/components/ScoreBadge';
import type { Job } from '@/lib/types';

const STATUSES = ['all', 'scored', 'unscored', 'shortlisted', 'archived'] as const;
type StatusFilter = (typeof STATUSES)[number];

export default function JobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [minScore, setMinScore] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const p = new URLSearchParams({ limit: '300' });
    if (search) p.set('search', search);
    if (minScore) p.set('minScore', minScore);
    if (status === 'shortlisted') p.set('shortlisted', 'true');
    else if (status !== 'all') p.set('status', status);
    const d = await fetch(`/api/jobs?${p.toString()}`).then((r) => r.json());
    setJobs(d.jobs ?? []);
    setTotal(d.total ?? 0);
    setLoading(false);
  }, [search, minScore, status]);

  useEffect(() => {
    const t = setTimeout(load, 250); // debounce search
    return () => clearTimeout(t);
  }, [load]);

  async function patch(id: string, body: Record<string, unknown>) {
    await fetch(`/api/jobs/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    load();
  }

  return (
    <div className="p-7 animate-slide-up">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-text tracking-tight">Jobs</h1>
          <p className="text-slate-muted text-[13px] mt-1">{total} matching · sorted by fit score</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search title, company, location…"
            className="pl-8 pr-3 py-1.5 w-72 bg-card border border-ink rounded-md text-[13px] text-slate-text placeholder:text-slate-muted focus:border-sky/40 outline-none"
          />
        </div>
        <div className="flex gap-1">
          {STATUSES.map((st) => (
            <button
              key={st}
              onClick={() => setStatus(st)}
              className={`px-3 py-1.5 text-[12px] rounded-md border capitalize transition-all ${
                status === st
                  ? 'bg-sky-glow text-sky border-sky/30'
                  : 'text-slate-muted border-ink hover:text-slate-text hover:bg-raised'
              }`}
            >
              {st}
            </button>
          ))}
        </div>
        <select
          value={minScore}
          onChange={(e) => setMinScore(e.target.value)}
          className="px-3 py-1.5 bg-card border border-ink rounded-md text-[12px] text-slate-text outline-none focus:border-sky/40"
        >
          <option value="">Any score</option>
          <option value="8">≥ 8</option>
          <option value="6">≥ 6</option>
          <option value="4">≥ 4</option>
        </select>
      </div>

      <div className="bg-card border border-ink rounded-xl overflow-hidden">
        {loading ? (
          <div className="px-5 py-10 text-center text-slate-muted text-[13px]">Loading…</div>
        ) : jobs.length === 0 ? (
          <div className="px-5 py-10 text-center text-slate-muted text-[13px]">No jobs match these filters.</div>
        ) : (
          <div className="divide-y divide-ink-subtle">
            {jobs.map((job) => {
              const open = expanded === job.id;
              return (
                <div key={job.id}>
                  <div className="flex items-center gap-4 px-5 py-3 hover:bg-raised transition-colors">
                    <button onClick={() => setExpanded(open ? null : job.id)} className="text-slate-muted hover:text-sky">
                      {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                    </button>
                    <ScoreBadge score={job.fit_score} />
                    <div className="flex-1 min-w-0">
                      <p className="text-slate-text text-[13px] font-medium truncate">{job.title}</p>
                      <p className="text-slate-muted text-[11px] truncate">
                        {job.company} · {job.location || 'Unknown'}
                        {job.salary ? ` · ${job.salary}` : ''}
                      </p>
                    </div>
                    {job.score_note && (
                      <p className="hidden lg:block max-w-xs truncate text-slate-muted text-[11px] italic">{job.score_note}</p>
                    )}
                    <button
                      onClick={() => patch(job.id, { is_shortlisted: !job.is_shortlisted })}
                      title="Shortlist"
                      className={job.is_shortlisted ? 'text-emerald' : 'text-slate-muted hover:text-emerald'}
                    >
                      <Star size={15} fill={job.is_shortlisted ? 'currentColor' : 'none'} />
                    </button>
                    <a
                      href={job.application_url || job.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Open posting"
                      className="text-slate-muted hover:text-sky"
                    >
                      <ExternalLink size={15} />
                    </a>
                    {job.status !== 'archived' && (
                      <button
                        onClick={() => patch(job.id, { status: 'archived' })}
                        title="Archive"
                        className="text-slate-muted hover:text-rose"
                      >
                        <Archive size={15} />
                      </button>
                    )}
                  </div>

                  {open && (
                    <div className="px-14 pb-5 pt-1 space-y-3 bg-base/40">
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
                          <p className="text-slate-muted text-[12px] leading-relaxed whitespace-pre-wrap line-clamp-[12]">
                            {job.full_description}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
