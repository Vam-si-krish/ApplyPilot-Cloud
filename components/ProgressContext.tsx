'use client';

/**
 * App-wide progress for user-initiated bulk jobs (AI scoring, company assessment,
 * résumé generation). The work runs as a client-side loop started on a page; those
 * loops keep running even after you switch tabs (their fetches aren't aborted on
 * unmount), but the progress toast used to live in the page's own state — so it
 * vanished the moment you navigated away. Lifting the state into this provider (which
 * lives in the authed layout and never unmounts during navigation) keeps the toast
 * pinned and live no matter which tab you're on. The auto-dismiss of a finished toast
 * is centralized here so it survives the starting page unmounting.
 */
import { createContext, useCallback, useContext, useRef, useState } from 'react';
import ProgressToast, { type ProgressTone } from '@/components/ProgressToast';

export interface BulkProgress {
  label: string;
  done: number;
  total: number;
  phase: 'running' | 'done';
  tone: ProgressTone;
}

interface ProgressCtx {
  progress: BulkProgress | null;
  /** Set the current toast (null to hide). A 'done' toast auto-clears after a few seconds. */
  setProgress: (p: BulkProgress | null) => void;
  /** True while a bulk job is actively running — use to block starting a second one. */
  running: boolean;
}

const Ctx = createContext<ProgressCtx | null>(null);

export function useProgress(): ProgressCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useProgress must be used within a ProgressProvider');
  return c;
}

export default function ProgressProvider({ children }: { children: React.ReactNode }) {
  const [progress, setProgressState] = useState<BulkProgress | null>(null);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setProgress = useCallback((p: BulkProgress | null) => {
    // Cancel any pending auto-dismiss so a fresh job's toast is never nulled by the
    // previous job's timer.
    if (clearTimer.current) {
      clearTimeout(clearTimer.current);
      clearTimer.current = null;
    }
    setProgressState(p);
    if (p && p.phase === 'done') {
      clearTimer.current = setTimeout(() => setProgressState(null), 6000);
    }
  }, []);

  return (
    <Ctx.Provider value={{ progress, setProgress, running: progress?.phase === 'running' }}>
      {children}
      {progress && <ProgressToast {...progress} />}
    </Ctx.Provider>
  );
}
