'use client';

import { useCallback, useEffect, useState } from 'react';
import { FileSearch, FileText, Star, AlarmClock, Play, RefreshCw } from 'lucide-react';
import ScoreBadge from '@/components/ScoreBadge';
import type { Job, Run } from '@/lib/types';

interface Stats {
  total: number;
  scored: number;
  shortlisted: number;
  unscored: number;
  score_distribution: [number, number][];
  last_run: Run | null;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [s, j] = await Promise.all([
      fetch('/api/stats').then((r) => r.json()),
      fetch('/api/jobs?limit=8').then((r) => r.json()),
    ]);
    setStats(s);
    setJobs(j.jobs ?? []);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load]);

  async function runNow() {
    setRunning(true);
    setMsg(null);
    try {
      const r = await fetch('/api/run', { method: 'POST' });
      const d = await r.json();
      setMsg(r.ok ? `Run started (Apify run ${d.apify_run_id}). Jobs will appear once the scrape finishes.` : `Error: ${d.error}`);
    } catch (e) {
      setMsg(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRunning(false);
      load();
    }
  }

  const s = stats;
  const cards = [
    { label: 'Discovered', value: s?.total ?? 0, icon: FileSearch, color: 'sky' as const },
    { label: 'Scored', value: s?.scored ?? 0, icon: FileText, color: 'amber' as const },
    { label: 'Shortlisted', value: s?.shortlisted ?? 0, icon: Star, color: 'emerald' as const },
    { label: 'Queued to score', value: s?.unscored ?? 0, icon: AlarmClock, color: 'sky' as const },
  ];

  return (
    <div className="p-7 animate-slide-up">
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-text tracking-tight">Dashboard</h1>
          <p className="text-slate-muted text-[13px] mt-1">Daily discovery &amp; AI fit scoring</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-slate-muted hover:text-sky border border-ink hover:border-sky/40 rounded-md transition-all"
          >
            <RefreshCw size={12} /> Refresh
          </button>
          <button
            onClick={runNow}
            disabled={running}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-sky border border-sky/30 bg-sky-glow hover:bg-sky/10 rounded-md transition-all disabled:opacity-50"
          >
            <Play size={12} /> {running ? 'Starting…' : 'Run now'}
          </button>
        </div>
      </div>

      {msg && (
        <div className="mb-6 px-4 py-3 rounded-lg border border-ink bg-card text-[13px] text-slate-text">{msg}</div>
      )}

      <div className="grid grid-cols-4 gap-4 mb-8">
        {cards.map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-card border border-ink rounded-xl p-5 hover:border-sky/20 transition-all group">
            <div className="flex items-center justify-between mb-3">
              <span className="text-slate-muted text-[12px] font-medium uppercase tracking-wider">{label}</span>
              <Icon size={14} className={`text-${color} opacity-60 group-hover:opacity-100 transition-opacity`} />
            </div>
            <span className={`font-display text-3xl font-bold text-${color}`}>{value}</span>
          </div>
        ))}
      </div>

      {s?.last_run && (
        <div className="bg-card border border-ink rounded-xl p-5 mb-6">
          <h2 className="font-display text-[13px] font-semibold text-slate-text mb-3 uppercase tracking-wider">Last Run</h2>
          <div className="flex gap-8 text-[13px]">
            <Field label="Status" value={s.last_run.status} />
            <Field label="Found" value={String(s.last_run.jobs_found)} />
            <Field label="Scored" value={String(s.last_run.jobs_scored)} />
            <Field label="Errors" value={String(s.last_run.errors)} />
            <Field label="Started" value={new Date(s.last_run.started_at).toLocaleString()} />
          </div>
        </div>
      )}

      {s && s.score_distribution.length > 0 && (
        <div className="bg-card border border-ink rounded-xl p-5 mb-6">
          <h2 className="font-display text-[13px] font-semibold text-slate-text mb-4 uppercase tracking-wider">Score Distribution</h2>
          <div className="flex items-end gap-2 h-20">
            {s.score_distribution
              .slice()
              .sort((a, b) => a[0] - b[0])
              .map(([score, count]) => {
                const max = Math.max(...s.score_distribution.map(([, c]) => c));
                const pct = max > 0 ? (count / max) * 100 : 0;
                const color = score >= 8 ? 'bg-emerald' : score >= 6 ? 'bg-amber' : 'bg-rose';
                return (
                  <div key={score} className="flex flex-col items-center gap-1 flex-1">
                    <span className="text-slate-muted font-mono text-[10px]">{count}</span>
                    <div className={`w-full rounded-sm ${color} opacity-80`} style={{ height: `${Math.max(pct * 0.6, 4)}px` }} />
                    <span className="text-slate-muted font-mono text-[10px]">{score}</span>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      <div className="bg-card border border-ink rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-ink-subtle">
          <h2 className="font-display text-[13px] font-semibold text-slate-text uppercase tracking-wider">Top Jobs</h2>
        </div>
        <div className="divide-y divide-ink-subtle">
          {jobs.length === 0 ? (
            <div className="px-5 py-8 text-center text-slate-muted text-[13px]">
              No jobs yet. Hit “Run now” or wait for the daily run.
            </div>
          ) : (
            jobs.map((job) => (
              <div key={job.id} className="flex items-center gap-4 px-5 py-3 hover:bg-raised transition-colors">
                <ScoreBadge score={job.fit_score} />
                <div className="flex-1 min-w-0">
                  <p className="text-slate-text text-[13px] font-medium truncate">{job.title}</p>
                  <p className="text-slate-muted text-[11px]">
                    {job.company} · {job.location || 'Unknown'}
                  </p>
                </div>
                {job.is_shortlisted && <Star size={14} className="text-emerald" />}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-slate-muted text-[11px] uppercase tracking-wider">{label}</p>
      <p className="text-slate-text font-mono text-[13px] mt-0.5">{value}</p>
    </div>
  );
}
