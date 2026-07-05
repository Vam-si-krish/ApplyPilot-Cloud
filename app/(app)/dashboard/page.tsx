'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { FileSearch, FileText, Star, AlarmClock, Play, RefreshCw, ExternalLink, ArrowRight, Activity } from 'lucide-react';
import ScoreBadge from '@/components/ScoreBadge';
import ScoringPanel from '@/components/ScoringPanel';
import type { Job, Run } from '@/lib/types';

interface Stats {
  total: number;
  scored: number;
  shortlisted: number;
  unscored: number;
  score_distribution: [number, number][];
  last_run: Run | null;
}

// Full literal classes per accent so Tailwind's scanner sees them (no runtime
// `text-${color}` interpolation — that only works via safelist and breaks silently).
const ACCENTS = {
  sky: { text: 'text-sky', chip: 'bg-sky/10 border-sky/25', ring: 'hover:border-sky/30' },
  amber: { text: 'text-amber', chip: 'bg-amber/10 border-amber/25', ring: 'hover:border-amber/30' },
  emerald: { text: 'text-emerald', chip: 'bg-emerald/10 border-emerald/25', ring: 'hover:border-emerald/30' },
  iris: { text: 'text-iris', chip: 'bg-iris/10 border-iris/25', ring: 'hover:border-iris/30' },
} as const;

const RUN_STATUS_STYLES: Record<string, string> = {
  succeeded: 'bg-emerald/10 border-emerald/30 text-emerald',
  running: 'bg-sky/10 border-sky/30 text-sky',
  failed: 'bg-rose/10 border-rose/30 text-rose',
};

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

  async function runNow(force = false) {
    setRunning(true);
    setMsg(null);
    try {
      const r = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force }),
      });
      const d = await r.json();
      if (r.ok && d.cooldown) {
        // Billed-per-result guard (ADR 0058): let the user consciously re-buy the window.
        if (window.confirm(`${d.reason}\n\nRun anyway?`)) return runNow(true);
        setMsg('Run skipped (recent fetch already covers this window).');
      } else {
        setMsg(r.ok ? `Run started (Apify run ${d.apify_run_id}). Jobs will appear once the scrape finishes.` : `Error: ${d.error}`);
      }
    } catch (e) {
      setMsg(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRunning(false);
      load();
    }
  }

  const s = stats;
  const cards = [
    { label: 'Discovered', value: s?.total ?? 0, icon: FileSearch, accent: ACCENTS.sky },
    { label: 'Scored', value: s?.scored ?? 0, icon: FileText, accent: ACCENTS.iris },
    { label: 'Shortlisted', value: s?.shortlisted ?? 0, icon: Star, accent: ACCENTS.emerald },
    { label: 'To score', value: s?.unscored ?? 0, icon: AlarmClock, accent: ACCENTS.amber },
  ];

  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-8 animate-slide-up">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-1 font-mono text-[11px] uppercase tracking-[0.14em] text-slate-dim">{today}</p>
          <h1 className="page-title text-2xl">Dashboard</h1>
          <p className="page-sub">Daily discovery &amp; AI fit scoring</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="btn-ghost px-3 py-1.5 text-[12px]">
            <RefreshCw size={12} /> Refresh
          </button>
          <button onClick={() => runNow()} disabled={running} className="btn-primary px-3.5 py-1.5 text-[12px]">
            <Play size={12} fill="currentColor" /> {running ? 'Starting…' : 'Run now'}
          </button>
        </div>
      </div>

      {msg && (
        <div className="mb-6 rounded-xl border border-sky/20 bg-sky/5 px-4 py-3 text-[13px] text-slate-text animate-fade-in">
          {msg}
        </div>
      )}

      {/* Live AI fit-scoring progress + Stop (ADR 0028). */}
      <ScoringPanel onActivity={load} />

      <div className="mb-8 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {cards.map(({ label, value, icon: Icon, accent }) => (
          <div key={label} className={`card group relative overflow-hidden p-5 transition-colors ${accent.ring}`}>
            <div className="mb-4 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-muted">{label}</span>
              <div className={`flex h-7 w-7 items-center justify-center rounded-lg border ${accent.chip}`}>
                <Icon size={13} className={accent.text} />
              </div>
            </div>
            <span className={`font-display text-[34px] font-bold leading-none tracking-tight ${accent.text}`}>
              {value}
            </span>
          </div>
        ))}
      </div>

      {s?.last_run && (
        <div className="card mb-6 p-5">
          <div className="mb-4 flex items-center gap-2">
            <Activity size={13} className="text-slate-dim" />
            <h2 className="font-display text-[12px] font-semibold uppercase tracking-[0.12em] text-slate-muted">Last run</h2>
            <span
              className={`chip ml-1 font-mono ${RUN_STATUS_STYLES[s.last_run.status] ?? 'bg-raised border-ink text-slate-muted'}`}
            >
              {s.last_run.status}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-[13px] sm:grid-cols-4">
            <Field label="Found" value={String(s.last_run.jobs_found)} />
            <Field label="Scored" value={String(s.last_run.jobs_scored)} />
            <Field label="Errors" value={String(s.last_run.errors)} accent={s.last_run.errors > 0 ? 'text-rose' : undefined} />
            <Field label="Started" value={new Date(s.last_run.started_at).toLocaleString()} />
          </div>
        </div>
      )}

      {s && s.score_distribution.length > 0 && (
        <div className="card mb-6 p-5">
          <h2 className="mb-5 font-display text-[12px] font-semibold uppercase tracking-[0.12em] text-slate-muted">
            Score distribution
          </h2>
          <div className="flex h-28 items-end gap-1.5 sm:gap-2">
            {s.score_distribution
              .slice()
              .sort((a, b) => a[0] - b[0])
              .map(([score, count]) => {
                const max = Math.max(...s.score_distribution.map(([, c]) => c));
                const pct = max > 0 ? (count / max) * 100 : 0;
                const color =
                  score >= 7
                    ? 'from-emerald/90 to-emerald/40'
                    : score >= 5
                      ? 'from-amber/90 to-amber/40'
                      : 'from-rose/80 to-rose/30';
                return (
                  <div key={score} className="group flex flex-1 flex-col items-center gap-1.5" title={`${count} job${count === 1 ? '' : 's'} scored ${score}`}>
                    <span className="font-mono text-[10px] text-slate-dim transition-colors group-hover:text-slate-text">{count}</span>
                    <div
                      className={`w-full rounded-t-md bg-gradient-to-t ${color} opacity-85 transition-opacity group-hover:opacity-100`}
                      style={{ height: `${Math.max(pct * 0.72, 5)}px` }}
                    />
                    <span className="font-mono text-[10px] text-slate-muted">{score}</span>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-ink-subtle px-5 py-4">
          <h2 className="font-display text-[12px] font-semibold uppercase tracking-[0.12em] text-slate-muted">Top jobs</h2>
          <Link href="/jobs" className="group flex items-center gap-1 text-[12px] font-medium text-sky transition-colors hover:text-sky/80">
            View all <ArrowRight size={12} className="transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
        <div className="divide-y divide-ink-subtle">
          {jobs.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <p className="text-[13px] text-slate-muted">No jobs yet. Hit “Run now” or wait for the daily run.</p>
            </div>
          ) : (
            jobs.map((job) => (
              <a
                key={job.id}
                href={job.application_url || job.url || '#'}
                target="_blank"
                rel="noopener noreferrer"
                title="Open posting"
                className="group flex items-center gap-4 px-5 py-3 transition-colors hover:bg-raised/60"
              >
                <ScoreBadge score={job.fit_score} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-slate-text transition-colors group-hover:text-sky">{job.title}</p>
                  <p className="truncate text-[11px] text-slate-muted">
                    {job.company} · {job.location || 'Unknown'}
                  </p>
                </div>
                {job.is_shortlisted && <Star size={14} className="shrink-0 text-emerald" fill="currentColor" fillOpacity={0.3} />}
                <ExternalLink size={13} className="shrink-0 text-slate-muted opacity-0 transition-opacity group-hover:opacity-100" />
              </a>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-[0.1em] text-slate-dim">{label}</p>
      <p className={`mt-0.5 font-mono text-[13px] ${accent ?? 'text-slate-text'}`}>{value}</p>
    </div>
  );
}
