'use client';

/**
 * Live scoring progress + Stop control (ADR 0028). Mirrors the Gmail SyncProgressPanel:
 * polls /api/score-status, shows a progress bar (done of total) while the single-flight
 * scorer runs, a Stop button that halts after the current batch (scored work is kept),
 * and a Start button when jobs are waiting. Polls fast (2.5s) while active, slow (12s)
 * while idle, so it isn't a constant fast network call. Calls `onActivity` so the host
 * page refreshes its job list as scores land.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Sparkles, Square, CheckCircle2, Loader2 } from 'lucide-react';

interface ScoreStatus {
  active: boolean;
  stop_requested: boolean;
  stale: boolean;
  total: number;
  done: number;
  errors: number;
  remaining: number;
}

export default function ScoringPanel({ onActivity }: { onActivity?: () => void }) {
  const [st, setSt] = useState<ScoreStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [flashDone, setFlashDone] = useState(false);
  const prevActive = useRef(false);
  const onAct = useRef(onActivity);
  onAct.current = onActivity;

  const poll = useCallback(async () => {
    try {
      const d = await fetch('/api/score-status').then((r) => (r.ok ? r.json() : null));
      if (!d || typeof d.active !== 'boolean') return;
      setSt(d);
      if (prevActive.current && !d.active) {
        // A run just finished — flash "done" and refresh the host list.
        setFlashDone(true);
        setTimeout(() => setFlashDone(false), 6000);
        onAct.current?.();
      } else if (d.active) {
        onAct.current?.(); // live updates as scores land
      }
      prevActive.current = d.active;
    } catch {
      /* ignore — next tick retries */
    }
  }, []);

  useEffect(() => {
    poll();
  }, [poll]);

  // Poll fast while active, slow while idle.
  useEffect(() => {
    const t = setInterval(poll, st?.active ? 2500 : 12000);
    return () => clearInterval(t);
  }, [poll, st?.active]);

  async function start() {
    setBusy(true);
    setFlashDone(false);
    try {
      await fetch('/api/score-start', { method: 'POST' });
    } finally {
      setBusy(false);
    }
    setTimeout(poll, 800);
  }

  async function stop() {
    setBusy(true);
    setSt((s) => (s ? { ...s, stop_requested: true } : s)); // optimistic
    try {
      await fetch('/api/score-stop', { method: 'POST' });
    } finally {
      setBusy(false);
    }
    setTimeout(poll, 800);
  }

  if (!st) return null;
  const running = st.active;
  const stopping = st.active && st.stop_requested;
  const pending = !st.active && st.remaining > 0;
  if (!running && !pending && !flashDone) return null; // nothing to show

  const pct = st.total > 0 ? Math.min(100, Math.round((st.done / st.total) * 100)) : null;

  const line = stopping
    ? `Stopping after this batch — ${st.done} of ${st.total} scored`
    : running
      ? `Scoring jobs — ${st.done} of ${st.total}${st.errors > 0 ? ` · ${st.errors} errored` : ''}`
      : flashDone
        ? `Done — scored ${st.done} job${st.done === 1 ? '' : 's'}${st.errors > 0 ? ` · ${st.errors} errored` : ''}`
        : `${st.remaining} job${st.remaining === 1 ? '' : 's'} waiting to score${st.stale ? ' · previous run stalled' : ''}`;

  return (
    <div className="bg-card border border-ink rounded-xl px-5 py-4 mb-5 animate-fade-in">
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          {running ? (
            <Loader2 size={14} className={`${stopping ? 'text-amber' : 'text-sky'} animate-spin shrink-0`} />
          ) : flashDone ? (
            <CheckCircle2 size={14} className="text-emerald shrink-0" />
          ) : (
            <Sparkles size={14} className="text-sky shrink-0" />
          )}
          <span className="text-[13px] text-slate-text font-medium truncate">{line}</span>
        </div>
        {running ? (
          <button
            onClick={stop}
            disabled={busy || stopping}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-rose bg-rose/10 border border-rose/30 hover:bg-rose/20 disabled:opacity-40 rounded-lg transition-all shrink-0"
          >
            <Square size={12} /> {stopping ? 'Stopping…' : 'Stop'}
          </button>
        ) : pending ? (
          <button
            onClick={start}
            disabled={busy}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-sky bg-sky/10 border border-sky/30 hover:bg-sky/20 disabled:opacity-40 rounded-lg transition-all shrink-0"
          >
            <Sparkles size={12} /> {busy ? 'Starting…' : 'Score now'}
          </button>
        ) : null}
      </div>
      {(running || flashDone) && (
        <div className="h-1.5 w-full bg-raised rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-300 ${flashDone ? 'bg-emerald' : stopping ? 'bg-amber' : 'bg-sky'} ${pct === null ? 'animate-pulse w-1/3' : ''}`}
            style={pct === null ? undefined : { width: `${flashDone ? 100 : pct}%` }}
          />
        </div>
      )}
    </div>
  );
}
