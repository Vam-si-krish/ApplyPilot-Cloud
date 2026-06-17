'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Star, ExternalLink, ChevronDown, ChevronRight, Archive, Search, CheckCircle2 } from 'lucide-react';
import ScoreBadge from '@/components/ScoreBadge';
import type { Job } from '@/lib/types';

const STATUSES = ['all', 'scored', 'unscored', 'shortlisted', 'applied', 'archived'] as const;
type StatusFilter = (typeof STATUSES)[number];

interface RunSummary {
  id: string;
  started_at: string;
  jobs_found: number;
  jobs_scored: number;
  status: string;
}

function formatRunLabel(run: RunSummary): string {
  const date = new Date(run.started_at);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const isToday = date.toDateString() === today.toDateString();
  const isYesterday = date.toDateString() === yesterday.toDateString();
  const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const day = isToday ? 'Today' : isYesterday ? 'Yesterday' : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const status = run.status === 'running' ? ' · running…' : '';
  return `${day} ${time} · ${run.jobs_found} jobs${status}`;
}

export default function JobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [minScore, setMinScore] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [easyApply, setEasyApply] = useState<boolean | null>(null);

  // Run selector
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  // Apply tracking: when user clicks an external link we wait for them to return.
  const pendingApplyJob = useRef<Job | null>(null);
  const [applyDialog, setApplyDialog] = useState<Job | null>(null);

  // Fetch the runs list once on mount.
  useEffect(() => {
    fetch('/api/runs')
      .then((r) => (r.ok ? r.json() : { runs: [] }))
      .then((d) => setRuns(d.runs ?? []))
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const p = new URLSearchParams({ limit: '300' });
    if (search) p.set('search', search);
    if (minScore) p.set('minScore', minScore);
    if (status === 'applied') p.set('applied', 'true');
    else if (status === 'shortlisted') p.set('shortlisted', 'true');
    else if (status !== 'all') p.set('status', status);
    if (easyApply === true) p.set('easyApply', 'true');
    if (easyApply === false) p.set('easyApply', 'false');
    if (selectedRunId) p.set('runId', selectedRunId);
    const d = await fetch(`/api/jobs?${p.toString()}`).then((r) => r.json());
    setJobs(d.jobs ?? []);
    setTotal(d.total ?? 0);
    setLoading(false);
  }, [search, minScore, status, easyApply, selectedRunId]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  // Detect when user returns to the tab after clicking an external job link.
  useEffect(() => {
    function onVisible() {
      if (!document.hidden && pendingApplyJob.current) {
        setApplyDialog(pendingApplyJob.current);
        pendingApplyJob.current = null;
      }
    }
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  async function patch(id: string, body: Record<string, unknown>) {
    await fetch(`/api/jobs/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    load();
  }

  function openJobLink(job: Job) {
    pendingApplyJob.current = job;
    window.open(job.application_url || job.url, '_blank', 'noopener,noreferrer');
  }

  async function markApplied(job: Job) {
    setApplyDialog(null);
    await patch(job.id, { applied_at: new Date().toISOString() });
  }

  const runLabel = selectedRunId
    ? (runs.find((r) => r.id === selectedRunId) ? formatRunLabel(runs.find((r) => r.id === selectedRunId)!) : 'Selected run')
    : null;

  return (
    <div className="p-7 animate-slide-up">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-text tracking-tight">Jobs</h1>
          <p className="text-slate-muted text-[13px] mt-1">{total} matching · sorted by fit score</p>
        </div>
      </div>

      {/* Run selector */}
      <div className="flex items-center gap-3 mb-4">
        <select
          value={selectedRunId ?? ''}
          onChange={(e) => setSelectedRunId(e.target.value || null)}
          className="px-3 py-1.5 bg-card border border-ink rounded-md text-[12px] text-slate-text outline-none focus:border-sky/40 max-w-xs"
        >
          <option value="">All runs</option>
          {runs.map((run) => (
            <option key={run.id} value={run.id}>
              {formatRunLabel(run)}
            </option>
          ))}
        </select>
        {selectedRunId && (
          <span className="flex items-center gap-1.5 text-[12px] text-sky bg-sky/10 border border-sky/20 px-2.5 py-1 rounded-md">
            Showing: {runLabel}
            <button onClick={() => setSelectedRunId(null)} className="text-sky/50 hover:text-rose transition-colors ml-1 leading-none">×</button>
          </span>
        )}
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
        <div className="flex gap-1 flex-wrap">
          {STATUSES.map((st) => (
            <button
              key={st}
              onClick={() => setStatus(st)}
              className={`px-3 py-1.5 text-[12px] rounded-md border capitalize transition-all ${
                status === st
                  ? st === 'applied'
                    ? 'bg-emerald/10 text-emerald border-emerald/30'
                    : 'bg-sky-glow text-sky border-sky/30'
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

        {/* Easy Apply filter */}
        <div className="flex gap-1">
          {([
            [null,  'All apply types'],
            [true,  'Easy Apply'],
            [false, 'Full application'],
          ] as [boolean | null, string][]).map(([val, label]) => (
            <button
              key={String(val)}
              onClick={() => setEasyApply(val)}
              className={`px-3 py-1.5 text-[12px] rounded-md border transition-all ${
                easyApply === val
                  ? val === true
                    ? 'bg-emerald/10 text-emerald border-emerald/30'
                    : val === false
                    ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                    : 'bg-sky-glow text-sky border-sky/30'
                  : 'text-slate-muted border-ink hover:text-slate-text hover:bg-raised'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
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

                    {/* Easy Apply / Full App badge */}
                    {job.easy_apply === true && (
                      <span className="shrink-0 hidden sm:inline px-1.5 py-0.5 text-[10px] font-medium bg-emerald/10 border border-emerald/25 text-emerald rounded">
                        Easy Apply
                      </span>
                    )}
                    {job.easy_apply === false && (
                      <span className="shrink-0 hidden sm:inline px-1.5 py-0.5 text-[10px] font-medium bg-amber-500/10 border border-amber-500/25 text-amber-400 rounded">
                        Full App
                      </span>
                    )}

                    {/* Applied badge */}
                    {job.applied_at && (
                      <span title={`Applied ${new Date(job.applied_at).toLocaleDateString()}`} className="shrink-0 text-emerald">
                        <CheckCircle2 size={15} />
                      </span>
                    )}

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
                    <button
                      onClick={() => openJobLink(job)}
                      title="Open posting (will ask if you applied)"
                      className="text-slate-muted hover:text-sky"
                    >
                      <ExternalLink size={15} />
                    </button>
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
                      {job.applied_at && (
                        <div className="flex items-center gap-2 text-emerald text-[12px]">
                          <CheckCircle2 size={13} />
                          Applied {new Date(job.applied_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          <button
                            onClick={() => patch(job.id, { applied_at: null })}
                            className="text-slate-muted hover:text-rose text-[11px] ml-1 underline"
                          >
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

      {/* "Did you apply?" dialog — fixed bottom-right, shown after returning from an external link */}
      {applyDialog && (
        <div className="fixed bottom-5 right-5 z-50 bg-card border border-ink rounded-xl p-4 shadow-2xl w-80 animate-slide-up">
          <p className="text-[13px] font-semibold text-slate-text mb-0.5">Did you apply?</p>
          <p className="text-[12px] text-slate-muted mb-4 truncate">
            {applyDialog.title}
            {applyDialog.company ? ` · ${applyDialog.company}` : ''}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => markApplied(applyDialog)}
              className="flex-1 px-3 py-2 text-[12px] font-medium text-emerald bg-emerald/10 border border-emerald/30 rounded-lg hover:bg-emerald/20 transition-all"
            >
              Yes, I applied ✓
            </button>
            <button
              onClick={() => setApplyDialog(null)}
              className="px-4 py-2 text-[12px] text-slate-muted border border-ink rounded-lg hover:bg-raised transition-all"
            >
              No
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
