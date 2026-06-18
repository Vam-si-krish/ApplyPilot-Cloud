'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Star, ExternalLink, ChevronDown, ChevronRight, Archive, Search, Trash2, ArrowLeft } from 'lucide-react';
import ScoreBadge from '@/components/ScoreBadge';
import JobDetails from '@/components/JobDetails';
import CompanyTierBadge from '@/components/CompanyTierBadge';
import JobsLegend from '@/components/JobsLegend';
import type { Job } from '@/lib/types';

const STATUSES = ['all', 'applied', 'archived', 'filtered', 'shortlisted', 'opened'] as const;
type StatusFilter = (typeof STATUSES)[number];

interface DateGroup {
  key: string;
  label: string;
  jobs: Job[];
}

/** A short status chip summarizing where a past job ended up. */
function statusChip(job: Job): { label: string; cls: string } {
  if (job.applied_at) return { label: 'Applied', cls: 'bg-emerald/10 border-emerald/25 text-emerald' };
  if (job.status === 'archived') return { label: 'Skipped', cls: 'bg-raised border-ink text-slate-muted' };
  if (job.status === 'filtered') return { label: 'Filtered', cls: 'bg-amber-500/10 border-amber-500/25 text-amber-400' };
  if (job.clicked_at) return { label: 'Opened', cls: 'bg-violet-500/10 border-violet-500/25 text-violet-300' };
  if (job.is_shortlisted) return { label: 'Shortlisted', cls: 'bg-emerald/10 border-emerald/25 text-emerald' };
  if (job.status === 'unscored') return { label: 'Unscored', cls: 'bg-raised border-ink text-slate-muted' };
  return { label: 'Scored', cls: 'bg-sky/10 border-sky/25 text-sky' };
}

function groupByDate(jobs: Job[]): DateGroup[] {
  const groups: DateGroup[] = [];
  for (const job of jobs) {
    const d = new Date(job.discovered_at);
    const key = d.toDateString();
    let g = groups.find((x) => x.key === key);
    if (!g) {
      g = { key, label: d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }), jobs: [] };
      groups.push(g);
    }
    g.jobs.push(job);
  }
  return groups;
}

export default function PastJobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const p = new URLSearchParams({ limit: '500', recency: 'past', order: 'date' });
    if (search) p.set('search', search);
    if (status === 'applied') p.set('applied', 'true');
    else if (status === 'shortlisted') p.set('shortlisted', 'true');
    else if (status === 'opened') p.set('opened', 'true');
    else if (status !== 'all') p.set('status', status);
    const d = await fetch(`/api/jobs?${p.toString()}`).then((r) => r.json());
    setJobs(d.jobs ?? []);
    setTotal(d.total ?? 0);
    setLoading(false);
  }, [search, status]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  async function patch(id: string, body: Record<string, unknown>) {
    await fetch(`/api/jobs/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    load();
  }
  async function deleteJob(id: string) {
    if (!confirm('Delete this job permanently?')) return;
    await fetch(`/api/jobs/${id}`, { method: 'DELETE' });
    load();
  }
  function openJobLink(job: Job) {
    window.open(job.application_url || job.url, '_blank', 'noopener,noreferrer');
    if (!job.clicked_at) {
      const now = new Date().toISOString();
      setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, clicked_at: now } : j)));
      fetch(`/api/jobs/${job.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clicked_at: now }) }).catch(() => {});
    }
  }

  const groups = groupByDate(jobs);

  return (
    <div className="p-7 animate-slide-up">
      <div className="mb-6">
        <Link href="/jobs" className="inline-flex items-center gap-1.5 text-[12px] text-slate-muted hover:text-sky mb-2 transition-colors">
          <ArrowLeft size={13} /> Back to recent jobs
        </Link>
        <h1 className="font-display text-2xl font-bold text-slate-text tracking-tight">Past Jobs</h1>
        <p className="text-slate-muted text-[13px] mt-1">{total} jobs older than 24h · grouped by day</p>
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
                status === st ? 'bg-sky-glow text-sky border-sky/30' : 'text-slate-muted border-ink hover:text-slate-text hover:bg-raised'
              }`}
            >
              {st}
            </button>
          ))}
        </div>
      </div>

      <JobsLegend />

      {loading ? (
        <div className="bg-card border border-ink rounded-xl px-5 py-10 text-center text-slate-muted text-[13px]">Loading…</div>
      ) : groups.length === 0 ? (
        <div className="bg-card border border-ink rounded-xl px-5 py-10 text-center text-slate-muted text-[13px]">No past jobs match these filters.</div>
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <div key={group.key}>
              <div className="flex items-center gap-3 mb-2">
                <h2 className="text-[13px] font-semibold text-slate-text font-display">{group.label}</h2>
                <span className="text-[11px] text-slate-muted">{group.jobs.length} job{group.jobs.length > 1 ? 's' : ''}</span>
                <div className="flex-1 h-px bg-ink-subtle" />
              </div>
              <div className="bg-card border border-ink rounded-xl overflow-hidden">
                <div className="divide-y divide-ink-subtle">
                  {group.jobs.map((job) => {
                    const open = expanded === job.id;
                    const chip = statusChip(job);
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
                              {job.company_size ? ` · ${job.company_size}` : ''}
                              <span className="text-slate-muted/70"> · {new Date(job.discovered_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                            </p>
                          </div>

                          <span className={`shrink-0 px-1.5 py-0.5 text-[10px] font-medium rounded border ${chip.cls}`}>{chip.label}</span>
                          {job.company_tier && (
                            <CompanyTierBadge tier={job.company_tier} note={job.company_tier_note} className="shrink-0 hidden sm:inline-flex" />
                          )}

                          <button
                            onClick={() => patch(job.id, { is_shortlisted: !job.is_shortlisted })}
                            title="Shortlist"
                            className={job.is_shortlisted ? 'text-emerald' : 'text-slate-muted hover:text-emerald'}
                          >
                            <Star size={15} fill={job.is_shortlisted ? 'currentColor' : 'none'} />
                          </button>
                          <button onClick={() => openJobLink(job)} title="Open posting" className="text-slate-muted hover:text-sky">
                            <ExternalLink size={15} />
                          </button>
                          <button
                            onClick={() => patch(job.id, { status: job.status === 'archived' ? 'scored' : 'archived' })}
                            title={job.status === 'archived' ? 'Restore' : 'Archive'}
                            className="text-slate-muted hover:text-rose"
                          >
                            <Archive size={15} />
                          </button>
                          <button onClick={() => deleteJob(job.id)} title="Delete permanently" className="text-slate-muted hover:text-rose">
                            <Trash2 size={15} />
                          </button>
                        </div>
                        {open && <JobDetails job={job} onPatch={patch} />}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
