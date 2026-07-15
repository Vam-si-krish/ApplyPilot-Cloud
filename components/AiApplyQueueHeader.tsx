'use client';

import { useState } from 'react';
import { Bot, Copy, KeyRound, Loader2, ShieldCheck } from 'lucide-react';
import { buildAiNavigationPrompt, isActiveAiApplyStatus } from '@/lib/aiApply';
import type { ApplicationWithJob } from '@/lib/types';

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
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
  const [copied, setCopied] = useState(false);
  const [pluginSetup, setPluginSetup] = useState<'idle' | 'loading' | 'copied'>('idle');
  const [pluginError, setPluginError] = useState('');
  const [pluginExpiresAt, setPluginExpiresAt] = useState('');
  const active = applications.filter((application) => isActiveAiApplyStatus(application.ai_apply_status));
  const working = active.filter((application) => application.ai_apply_status === 'in_progress').length;

  async function copyPrompt() {
    await copyText(buildAiNavigationPrompt(active));
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  async function copyPluginSetup() {
    setPluginSetup('loading');
    setPluginError('');
    try {
      const response = await fetch('/api/ai-agent/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: 'Codex MCP' }),
      });
      const body = await response.json() as { token?: string; expiresAt?: string; error?: string };
      if (!response.ok || !body.token) throw new Error(body.error || 'Could not create plugin access.');
      const setup = [
        `export APPLYPILOT_URL=${JSON.stringify(window.location.origin)}`,
        `export APPLYPILOT_AI_TOKEN=${JSON.stringify(body.token)}`,
      ].join('\n');
      await copyText(setup);
      setPluginExpiresAt(body.expiresAt || '');
      setPluginSetup('copied');
      setTimeout(() => setPluginSetup('idle'), 5000);
    } catch (cause) {
      setPluginError(cause instanceof Error ? cause.message : String(cause));
      setPluginSetup('idle');
    }
  }

  return (
    <div className="mb-4 rounded-xl border border-sky/25 bg-gradient-to-br from-sky/10 via-card to-violet-500/[0.06] p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-sky/30 bg-sky/10 text-sky">
          <Bot size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[14px] font-semibold text-slate-text">AI Apply Navigator · Phase 1</h2>
            <span className="rounded-md border border-ink bg-base/60 px-2 py-0.5 text-[10px] font-mono text-slate-muted">
              {active.length} assigned · {working} working
            </span>
          </div>
          <p className="mt-1 max-w-3xl text-[12px] leading-relaxed text-slate-muted">
            The ApplyPilot plugin reads this live queue. Your extension fills first; AI completes any missed fields from
            your saved information, navigates, submits, and continues to the next job in a new tab.
          </p>
          <p className="mt-1 text-[11px] text-amber-400/90">
            All unapplied jobs with a usable link are eligible. Unknown answers move the job to Needs review without stopping the queue.
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <div className="flex flex-wrap justify-end gap-2">
            <button
              onClick={copyPluginSetup}
              disabled={pluginSetup === 'loading'}
              title="Create a revocable two-hour MCP run and copy its local setup"
              className="inline-flex items-center gap-1.5 rounded-lg border border-violet-400/30 bg-violet-500/10 px-3 py-2 text-[12px] font-medium text-violet-300 transition-all hover:bg-violet-500/20 disabled:cursor-wait disabled:opacity-50"
            >
              {pluginSetup === 'loading' ? <Loader2 size={14} className="animate-spin" />
                : pluginSetup === 'copied' ? <ShieldCheck size={14} /> : <KeyRound size={14} />}
              {pluginSetup === 'loading' ? 'Creating…' : pluginSetup === 'copied' ? 'MCP setup copied' : 'Connect ApplyPilot plugin'}
            </button>
            <button
              onClick={copyPrompt}
              disabled={active.length === 0}
              title="Fallback: copy the navigation prompt for the next twenty assigned applications"
              className="inline-flex items-center gap-1.5 rounded-lg border border-sky/30 bg-sky/10 px-3 py-2 text-[12px] font-medium text-sky transition-all hover:bg-sky/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {copied ? <ShieldCheck size={14} /> : <Copy size={14} />}
              {copied ? 'Prompt copied' : 'Copy fallback prompt'}
            </button>
          </div>
          {pluginSetup === 'copied' && (
            <span className="text-[10px] text-emerald">Paste into the terminal that starts Codex · expires {pluginExpiresAt ? new Date(pluginExpiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'in 2 hours'}</span>
          )}
          {pluginError && <span className="max-w-md text-right text-[10px] text-red-400">{pluginError}</span>}
        </div>
      </div>
    </div>
  );
}
