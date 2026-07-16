'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, CheckCircle2, Copy, Link2, Loader2, ShieldCheck, Unplug } from 'lucide-react';
import { buildAiNavigationPrompt, isActiveAiApplyStatus } from '@/lib/aiApply';
import type { ApplicationWithJob } from '@/lib/types';

interface AgentRun {
  id: string;
  label: string;
  expires_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
  created_at: string;
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
  }
}

export default function AiApplyQueueHeader({ applications }: { applications: ApplicationWithJob[] }) {
  const [copied, setCopied] = useState<'pairing' | 'prompt' | null>(null);
  const [pairing, setPairing] = useState<{ code: string; expiresAt: string } | null>(null);
  const [pairingLoading, setPairingLoading] = useState(false);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [connectionLoading, setConnectionLoading] = useState(true);
  const [error, setError] = useState('');

  const active = useMemo(
    () => applications.filter((application) => isActiveAiApplyStatus(application.ai_apply_status)),
    [applications],
  );
  const working = active.filter((application) => application.ai_apply_status === 'in_progress').length;
  const needsReview = applications.filter((application) => application.ai_apply_status === 'blocked').length;
  const submitted = applications.filter((application) => application.ai_apply_status === 'submitted').length;
  const connectedRun = runs.find((run) => !run.revoked_at && new Date(run.expires_at).getTime() > Date.now());

  const loadRuns = useCallback(async () => {
    try {
      const response = await fetch('/api/ai-agent/runs', { cache: 'no-store' });
      const body = await response.json() as { runs?: AgentRun[]; error?: string };
      if (!response.ok) throw new Error(body.error || 'Could not check the Codex connection.');
      setRuns(body.runs || []);
      if ((body.runs || []).some((run) => !run.revoked_at && new Date(run.expires_at).getTime() > Date.now())) {
        setPairing(null);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setConnectionLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRuns();
    const timer = window.setInterval(() => void loadRuns(), pairing ? 3000 : 15000);
    return () => window.clearInterval(timer);
  }, [loadRuns, pairing]);

  async function createPairing() {
    setPairingLoading(true);
    setError('');
    try {
      const response = await fetch('/api/ai-agent/pairings', { method: 'POST' });
      const body = await response.json() as { code?: string; expiresAt?: string; error?: string };
      if (!response.ok || !body.code || !body.expiresAt) throw new Error(body.error || 'Could not create a pairing code.');
      setPairing({ code: body.code, expiresAt: body.expiresAt });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPairingLoading(false);
    }
  }

  async function copyPairing() {
    if (!pairing) return;
    await copyText(`Connect ApplyPilot using pairing code ${pairing.code}, then work through my assigned AI Apply jobs.`);
    setCopied('pairing');
    setTimeout(() => setCopied(null), 2500);
  }

  async function disconnect() {
    if (!connectedRun) return;
    setConnectionLoading(true);
    setError('');
    try {
      const response = await fetch('/api/ai-agent/runs', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: connectedRun.id }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || 'Could not disconnect Codex.');
      await loadRuns();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setConnectionLoading(false);
    }
  }

  async function copyPrompt() {
    await copyText(buildAiNavigationPrompt(active));
    setCopied('prompt');
    setTimeout(() => setCopied(null), 2500);
  }

  return (
    <section className="mb-4 overflow-hidden rounded-xl border border-sky/25 bg-gradient-to-br from-sky/10 via-card to-violet-500/[0.06]">
      <div className="flex flex-wrap items-start gap-4 p-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-sky/30 bg-sky/10 text-sky">
          <Bot size={19} />
        </div>
        <div className="min-w-[240px] flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[14px] font-semibold text-slate-text">AI Apply</h2>
            {connectionLoading ? (
              <span className="inline-flex items-center gap-1 text-[10px] text-slate-muted"><Loader2 size={11} className="animate-spin" />Checking connection</span>
            ) : connectedRun ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald/30 bg-emerald/10 px-2 py-0.5 text-[10px] font-medium text-emerald"><CheckCircle2 size={11} />Codex connected</span>
            ) : (
              <span className="rounded-full border border-ink bg-base/60 px-2 py-0.5 text-[10px] text-slate-muted">Not connected</span>
            )}
          </div>
          <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-slate-muted">
            Assign jobs here, pair Codex once, and follow progress without copying private access tokens.
            Autofill works first; AI handles missed fields from your saved profile and sets unknown answers aside for review.
          </p>
          <div className="mt-3 grid max-w-xl grid-cols-4 gap-2">
            {[
              ['Assigned', active.length],
              ['Working', working],
              ['Needs review', needsReview],
              ['Submitted', submitted],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-lg border border-ink/80 bg-base/45 px-2.5 py-2">
                <div className="text-[16px] font-semibold text-slate-text">{value}</div>
                <div className="truncate text-[10px] text-slate-muted">{label}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex min-w-[280px] flex-col items-end gap-2">
          {connectedRun ? (
            <>
              <button
                onClick={disconnect}
                disabled={connectionLoading}
                className="inline-flex items-center gap-1.5 rounded-lg border border-red-400/25 bg-red-500/10 px-3 py-2 text-[12px] font-medium text-red-300 transition-colors hover:bg-red-500/20 disabled:opacity-50"
              >
                {connectionLoading ? <Loader2 size={14} className="animate-spin" /> : <Unplug size={14} />}
                Disconnect Codex
              </button>
              <span className="text-[10px] text-slate-muted">
                {connectedRun.last_used_at ? `Last activity ${new Date(connectedRun.last_used_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Connected and ready'}
                {' · '}expires {new Date(connectedRun.expires_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
              </span>
            </>
          ) : pairing ? (
            <div className="w-full max-w-sm rounded-xl border border-violet-400/30 bg-violet-500/10 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[10px] font-medium uppercase tracking-wider text-violet-300">One-time pairing code</div>
                  <div className="mt-1 font-mono text-[20px] font-semibold tracking-wider text-slate-text">{pairing.code}</div>
                </div>
                <button onClick={copyPairing} className="rounded-lg border border-violet-400/30 p-2 text-violet-300 hover:bg-violet-500/20" title="Copy pairing instruction">
                  {copied === 'pairing' ? <ShieldCheck size={16} /> : <Copy size={16} />}
                </button>
              </div>
              <p className="mt-2 text-[10px] leading-relaxed text-slate-muted">
                Give this code to Codex. It expires at {new Date(pairing.expiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} and stops working after one use.
              </p>
            </div>
          ) : (
            <button
              onClick={createPairing}
              disabled={pairingLoading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-violet-400/30 bg-violet-500/10 px-3 py-2 text-[12px] font-medium text-violet-300 transition-colors hover:bg-violet-500/20 disabled:cursor-wait disabled:opacity-50"
            >
              {pairingLoading ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />}
              {pairingLoading ? 'Creating code…' : 'Pair Codex'}
            </button>
          )}
          <button
            onClick={copyPrompt}
            disabled={active.length === 0}
            className="inline-flex items-center gap-1.5 px-1 py-1 text-[11px] text-slate-muted hover:text-sky disabled:cursor-not-allowed disabled:opacity-40"
            title="Fallback when the plugin is unavailable"
          >
            <Copy size={12} />{copied === 'prompt' ? 'Fallback prompt copied' : 'Copy fallback prompt'}
          </button>
          {error && <span className="max-w-sm text-right text-[10px] text-red-400">{error}</span>}
        </div>
      </div>
      <div className="grid border-t border-ink/80 bg-base/25 sm:grid-cols-3">
        {[
          ['1', 'Assign jobs', 'Move any job into the AI Apply queue.'],
          ['2', 'Pair once', 'Use the single-use code; no private token copying.'],
          ['3', 'Follow progress', 'Review working, submitted, or blocked jobs here.'],
        ].map(([number, title, description]) => (
          <div key={number} className="flex gap-2.5 border-b border-ink/70 px-4 py-2.5 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sky/10 text-[10px] font-semibold text-sky">{number}</span>
            <div><div className="text-[11px] font-medium text-slate-text">{title}</div><div className="text-[10px] text-slate-muted">{description}</div></div>
          </div>
        ))}
      </div>
    </section>
  );
}
