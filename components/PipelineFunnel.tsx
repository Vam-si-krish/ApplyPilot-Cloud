'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, Loader2, AlertCircle } from 'lucide-react';

/**
 * Live funnel view of the auto-pipeline (ADR 0044/0045). Reads /api/pipeline, which
 * derives every count from the database (job statuses + scoring_state + applications) —
 * so it is fully REFRESH-SAFE: a reload re-reads the true current state, no in-memory
 * progress to lose. Polls on an interval for live updates (the data lives on the
 * always-on worker/DB, so polling is cheap and always has a source to read).
 */

type Stage = {
  key: string;
  label: string;
  count?: number;
  archived?: number;
  isCull?: boolean;
  sub?: string;
};

type PipelineData = {
  enabled: boolean;
  cutoff: number;
  stage: 'idle' | 'fetching' | 'scoring';
  detail: string;
  pending: string; // backlog summary, shown when idle (e.g. "230 to assess · 28 queued to tailor")
  stages: Stage[];
};

// Maps the live `stage` to the funnel box it highlights. Only genuinely-running stages
// (fetch / score) light up; idle highlights nothing.
const STAGE_TO_KEY: Record<PipelineData['stage'], string | null> = {
  idle: null,
  fetching: 'fetched',
  scoring: 'scored',
};

const STAGE_LABEL: Record<PipelineData['stage'], string> = {
  idle: 'Idle',
  fetching: 'Fetching',
  scoring: 'Scoring jobs',
};

const POLL_MS = 4000; // responsive live-step; data is on the always-on DB, cheap to read

export default function PipelineFunnel() {
  const [data, setData] = useState<PipelineData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [connected, setConnected] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/pipeline', { cache: 'no-store' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setData(d);
      setErr(null);
      setConnected(true);
    } catch (e) {
      // Keep the last good data on screen; just flag the connection as degraded.
      setConnected(false);
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // Self-rescheduling poll (setTimeout, not setInterval) so a slow request can't stack
  // up calls, and so it keeps ticking across refreshes. Re-fetches immediately on mount.
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      if (!alive) return;
      await load();
      if (alive) timer.current = setTimeout(tick, POLL_MS);
    };
    tick();
    // Refresh the moment the tab regains focus, so it's never stale after you switch back.
    const onVisible = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      if (timer.current) clearTimeout(timer.current);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  if (!data) {
    return (
      <div className="mb-8 bg-card border border-ink rounded-xl p-5">
        <div className="flex items-center gap-2 text-slate-muted text-[13px]">
          {err ? <AlertCircle size={14} className="text-rose" /> : <Loader2 size={14} className="animate-spin" />}
          {err ? `Pipeline status unavailable — ${err}` : 'Loading pipeline…'}
        </div>
      </div>
    );
  }

  const activeKey = STAGE_TO_KEY[data.stage];
  const isRunning = data.stage === 'fetching' || data.stage === 'scoring';

  return (
    <div className="mb-8 bg-card border border-ink rounded-xl p-5">
      {/* Header: current step + connection indicator. The boxes below are the CURRENT STATE
          of all jobs in the system (cumulative), not one run — hence the "all jobs" label. */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h2 className="font-display text-[13px] font-semibold text-slate-text uppercase tracking-wider">Pipeline</h2>
          <span className="text-[11px] text-slate-muted normal-case tracking-normal">· all jobs</span>
          {!data.enabled && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-raised border border-ink text-slate-muted uppercase tracking-wider">
              auto off
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-[12px]">
            {isRunning ? (
              <Loader2 size={13} className="animate-spin text-sky" />
            ) : (
              <span className="w-2 h-2 rounded-full bg-slate-muted/50" />
            )}
            <span className={isRunning ? 'text-sky' : 'text-slate-muted'}>{STAGE_LABEL[data.stage]}</span>
            {/* When running: the live detail. When idle: the standing backlog, clearly NOT "running". */}
            {isRunning && data.detail && <span className="text-slate-muted">· {data.detail}</span>}
            {!isRunning && data.pending && <span className="text-slate-muted">· {data.pending} pending</span>}
          </div>
          {/* Live connection dot — green when the last poll succeeded, amber when degraded. */}
          <span
            title={connected ? 'Live — updating every 4s' : 'Reconnecting… (showing last known state)'}
            className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald animate-pulse' : 'bg-amber'}`}
          />
        </div>
      </div>

      {/* Funnel: stage boxes (with counts) and cull markers (archived), flowing left→right. */}
      <div className="flex items-stretch gap-1.5 overflow-x-auto pb-1">
        {data.stages.map((st, i) => {
          const isLast = i === data.stages.length - 1;
          if (st.isCull) {
            // A cull marker — only shown when something was actually archived here.
            if (!st.archived) return null;
            return (
              <div key={st.key} className="flex items-center shrink-0">
                <div className="flex flex-col items-center justify-center px-2 py-1 rounded-md bg-rose/5 border border-rose/20 min-w-[84px]">
                  <span className="text-[15px] font-semibold text-rose/90 tabular-nums">−{st.archived}</span>
                  <span className="text-[9px] text-rose/70 uppercase tracking-wider text-center leading-tight mt-0.5">{st.label}</span>
                </div>
                {!isLast && <ArrowRight size={13} className="text-slate-muted/40 mx-0.5 shrink-0" />}
              </div>
            );
          }
          const active = st.key === activeKey;
          return (
            <div key={st.key} className="flex items-center shrink-0">
              <div
                className={`flex flex-col items-center justify-center px-3 py-2 rounded-lg border min-w-[92px] transition-all ${
                  active ? 'bg-sky/10 border-sky/40 ring-1 ring-sky/30' : 'bg-raised border-ink'
                }`}
              >
                <span className={`text-[18px] font-bold tabular-nums ${active ? 'text-sky' : 'text-slate-text'}`}>
                  {st.count ?? 0}
                </span>
                <span className="text-[10px] text-slate-muted uppercase tracking-wider text-center leading-tight mt-0.5">
                  {st.label}
                </span>
                {st.sub && <span className="text-[9px] text-slate-muted/70 text-center leading-tight mt-0.5">{st.sub}</span>}
              </div>
              {!isLast && <ArrowRight size={14} className="text-slate-muted/40 mx-0.5 shrink-0" />}
            </div>
          );
        })}
      </div>

      {!connected && (
        <p className="text-[11px] text-amber mt-3">
          Connection to the server dropped — showing the last known state and retrying. The pipeline keeps running on the
          worker regardless.
        </p>
      )}
    </div>
  );
}
