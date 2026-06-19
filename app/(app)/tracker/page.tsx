'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { TrendingUp, Flame, Trophy, Activity, ChevronDown, ChevronRight, CheckCircle2 } from 'lucide-react';
import type { MailCategory } from '@/lib/types';
import {
  type AppliedEvent,
  type Granularity,
  series,
  momentum,
  currentStreak,
  groupByDay,
  dayExtremes,
} from '@/lib/trackerStats';

interface StatsData {
  connected: boolean;
  email: string | null;
  applied: AppliedEvent[];
  totals: Record<string, number>;
  applySources?: { easy_apply: number; company_portal: number; unknown: number };
}

const GRAN: { id: Granularity; label: string; periods: number }[] = [
  { id: 'day', label: 'Daily', periods: 30 },
  { id: 'week', label: 'Weekly', periods: 12 },
  { id: 'month', label: 'Monthly', periods: 12 },
];

// Funnel categories, in pipeline order, with their accent colors.
const FUNNEL: { cat: MailCategory; label: string; dot: string; text: string }[] = [
  { cat: 'applied', label: 'Applied', dot: 'bg-sky', text: 'text-sky' },
  { cat: 'shortlisted', label: 'Shortlisted', dot: 'bg-emerald', text: 'text-emerald' },
  { cat: 'assessment', label: 'Assessments', dot: 'bg-violet-400', text: 'text-violet-300' },
  { cat: 'action_needed', label: 'Action needed', dot: 'bg-amber-400', text: 'text-amber-400' },
  { cat: 'rejection', label: 'Rejections', dot: 'bg-rose', text: 'text-rose' },
];

export default function TrackerPage() {
  const [data, setData] = useState<StatsData | null>(null);
  const [gran, setGran] = useState<Granularity>('day');
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/mail/stats')
      .then((r) => r.json())
      .then((d) => setData(d))
      .catch(() => {});
  }, []);

  const applied = useMemo(() => data?.applied ?? [], [data]);
  const now = new Date();
  const cfg = GRAN.find((g) => g.id === gran)!;
  const bars = useMemo(() => series(applied, gran, cfg.periods, now), [applied, gran, cfg.periods]);
  const mo = useMemo(() => momentum(applied, now), [applied]);
  const streak = useMemo(() => currentStreak(applied, now), [applied]);
  const days = useMemo(() => groupByDay(applied), [applied]);
  const { best, avgPerActiveDay } = useMemo(() => dayExtremes(days), [days]);
  const maxBar = Math.max(1, ...bars.map((b) => b.count));

  if (data && !data.connected) {
    return (
      <div className="p-7 animate-slide-up">
        <Header />
        <div className="bg-card border border-ink rounded-xl px-6 py-12 text-center">
          <div className="w-12 h-12 rounded-xl bg-emerald/10 border border-emerald/20 flex items-center justify-center mx-auto mb-4">
            <TrendingUp size={22} className="text-emerald" />
          </div>
          <p className="text-slate-text text-[14px] font-medium mb-1">Connect Gmail to track your applications</p>
          <p className="text-slate-muted text-[12px] mb-5">
            The tracker counts the &ldquo;Applied&rdquo; confirmation emails the AI sorts in your Inbox.
          </p>
          <Link href="/settings" className="inline-flex px-4 py-2 text-[13px] font-medium text-sky bg-sky/10 border border-sky/30 hover:bg-sky/20 rounded-lg transition-all">
            Go to Settings → Gmail
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="p-7 animate-slide-up">
      <Header email={data?.email ?? null} total={mo.all} />

      {/* Momentum cards */}
      <div className="grid grid-cols-4 gap-4 mb-4">
        <MomentumCard label="Today" value={mo.today} accent="text-emerald" icon={CheckCircle2} sub={streak > 0 ? `${streak}-day streak` : 'no streak yet'} />
        <MomentumCard label="This week" value={mo.week} accent="text-sky" icon={Activity} sub={`${avgPerActiveDay ? avgPerActiveDay.toFixed(1) : '0'}/active day`} />
        <MomentumCard label="This month" value={mo.month} accent="text-violet-300" icon={TrendingUp} sub={cfg.label.toLowerCase()} />
        <MomentumCard label="All time" value={mo.all} accent="text-slate-text" icon={Trophy} sub={best ? `best day: ${best.count}` : '—'} />
      </div>

      {/* Pipeline funnel */}
      <div className="bg-card border border-ink rounded-xl p-5 mb-5">
        <h2 className="font-display text-[12px] font-semibold text-slate-muted uppercase tracking-wider mb-3">Pipeline</h2>
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
          {FUNNEL.map((f) => (
            <div key={f.cat} className="flex items-center gap-2.5">
              <span className={`w-2 h-2 rounded-full ${f.dot}`} />
              <span className={`font-display text-2xl font-bold ${f.text}`}>{data?.totals?.[f.cat] ?? 0}</span>
              <span className="text-slate-muted text-[12px]">{f.label}</span>
            </div>
          ))}
        </div>
        {/* How those applications were submitted (ADR 0021) */}
        {data?.applySources && (data.applySources.easy_apply + data.applySources.company_portal + data.applySources.unknown) > 0 && (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mt-4 pt-3 border-t border-ink-subtle">
            <span className="text-[11px] text-slate-muted uppercase tracking-wider">Applied via</span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-sky" />
              <span className="font-display text-lg font-bold text-sky">{data.applySources.easy_apply}</span>
              <span className="text-slate-muted text-[12px]">Easy Apply</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald" />
              <span className="font-display text-lg font-bold text-emerald">{data.applySources.company_portal}</span>
              <span className="text-slate-muted text-[12px]">Company portal</span>
            </span>
            {data.applySources.unknown > 0 && <span className="text-[12px] text-slate-muted">· {data.applySources.unknown} unspecified</span>}
          </div>
        )}
      </div>

      {/* Volume chart with day/week/month toggle */}
      <div className="bg-card border border-ink rounded-xl p-5 mb-5">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-display text-[12px] font-semibold text-slate-muted uppercase tracking-wider">Applications over time</h2>
          <div className="flex gap-1 bg-raised border border-ink rounded-lg p-0.5">
            {GRAN.map((g) => (
              <button
                key={g.id}
                onClick={() => setGran(g.id)}
                className={`px-3 py-1 text-[12px] rounded-md transition-all ${
                  gran === g.id ? 'bg-sky/15 text-sky' : 'text-slate-muted hover:text-slate-text'
                }`}
              >
                {g.label}
              </button>
            ))}
          </div>
        </div>

        {mo.all === 0 ? (
          <p className="text-slate-muted text-[13px] py-8 text-center">
            No application confirmations yet. They’ll show up here as the AI sorts your Inbox.
          </p>
        ) : (
          <div className="flex items-end gap-1.5 h-44">
            {bars.map((b) => {
              const h = b.count === 0 ? 2 : Math.max(6, (b.count / maxBar) * 150);
              return (
                <div key={b.key} className="flex-1 flex flex-col items-center gap-1.5 min-w-0 group">
                  <span className={`font-mono text-[10px] ${b.count > 0 ? 'text-slate-text' : 'text-transparent'}`}>{b.count}</span>
                  <div
                    title={`${b.label}: ${b.count}`}
                    className={`w-full rounded-sm transition-all ${b.count > 0 ? 'bg-emerald/80 group-hover:bg-emerald' : 'bg-raised'}`}
                    style={{ height: `${h}px` }}
                  />
                  <span className="text-slate-muted font-mono text-[9px] truncate w-full text-center">{b.label}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Day-by-day breakdown with per-day summary */}
      <div className="bg-card border border-ink rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-ink-subtle">
          <h2 className="font-display text-[12px] font-semibold text-slate-muted uppercase tracking-wider">Day-by-day</h2>
        </div>
        {days.length === 0 ? (
          <div className="px-5 py-10 text-center text-slate-muted text-[13px]">Nothing applied yet.</div>
        ) : (
          <div className="divide-y divide-ink-subtle">
            {days.slice(0, 60).map((d) => {
              const open = expanded === d.date;
              const preview = d.items
                .map((i) => i.company)
                .filter(Boolean)
                .slice(0, 4)
                .join(', ');
              return (
                <div key={d.date}>
                  <button
                    onClick={() => setExpanded(open ? null : d.date)}
                    className="w-full flex items-center gap-3 px-5 py-3 hover:bg-raised transition-colors text-left"
                  >
                    {open ? <ChevronDown size={15} className="text-slate-muted shrink-0" /> : <ChevronRight size={15} className="text-slate-muted shrink-0" />}
                    <span className="shrink-0 w-28 text-slate-text text-[13px] font-medium">{d.label}</span>
                    <span className="shrink-0 inline-flex items-center justify-center min-w-[2rem] px-1.5 py-0.5 text-[11px] font-mono font-semibold rounded-md bg-emerald/10 border border-emerald/25 text-emerald">
                      {d.count}
                    </span>
                    <span className="text-slate-muted text-[12px] truncate">
                      {d.count === 1 ? '1 application' : `${d.count} applications`}
                      {preview ? <span className="text-slate-muted/70"> · {preview}{d.items.length > 4 ? '…' : ''}</span> : ''}
                    </span>
                  </button>
                  {open && (
                    <div className="px-5 pb-3 pl-12 space-y-2">
                      {d.items.map((i, idx) => (
                        <div key={idx} className="flex items-start gap-3 py-1.5 border-t border-ink-subtle first:border-0">
                          <span className="shrink-0 text-[11px] text-slate-muted font-mono mt-0.5 w-12">
                            {new Date(i.received_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                          </span>
                          <div className="min-w-0">
                            <p className="text-slate-text text-[13px] font-medium truncate">{i.subject || i.company || '(application)'}</p>
                            {(i.summary || i.company) && (
                              <p className="text-slate-muted text-[11px] truncate">
                                {i.company ? <span className="text-slate-muted/90">{i.company}</span> : ''}
                                {i.company && i.summary ? ' — ' : ''}
                                {i.summary || ''}
                              </p>
                            )}
                          </div>
                        </div>
                      ))}
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

function Header({ email, total }: { email?: string | null; total?: number }) {
  return (
    <div className="mb-6">
      <h1 className="font-display text-2xl font-bold text-slate-text tracking-tight flex items-center gap-2">
        <TrendingUp size={20} className="text-emerald" /> Application Tracker
      </h1>
      <p className="text-slate-muted text-[13px] mt-1">
        How many jobs you’ve applied to over time, from your &ldquo;Applied&rdquo; confirmation emails
        {typeof total === 'number' ? ` · ${total} total` : ''}
        {email ? ` · ${email}` : ''}
      </p>
    </div>
  );
}

function MomentumCard({
  label,
  value,
  accent,
  sub,
  icon: Icon,
}: {
  label: string;
  value: number;
  accent: string;
  sub: string;
  icon: typeof Flame;
}) {
  return (
    <div className="bg-card border border-ink rounded-xl p-5">
      <div className="flex items-center justify-between mb-2">
        <span className="text-slate-muted text-[12px] font-medium uppercase tracking-wider">{label}</span>
        <Icon size={14} className={`${accent} opacity-60`} />
      </div>
      <span className={`font-display text-3xl font-bold ${accent}`}>{value}</span>
      <p className="text-slate-muted text-[11px] mt-1">{sub}</p>
    </div>
  );
}
