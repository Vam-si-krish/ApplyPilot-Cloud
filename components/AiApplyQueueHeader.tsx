'use client';

import { useState } from 'react';
import { Bot, Copy, ShieldCheck } from 'lucide-react';
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
  const active = applications.filter((application) => isActiveAiApplyStatus(application.ai_apply_status));
  const working = active.filter((application) => application.ai_apply_status === 'in_progress').length;

  async function copyPrompt() {
    await copyText(buildAiNavigationPrompt(active));
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
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
            Copy the @Chrome handoff once. Your extension fills first; AI completes any missed fields from your saved
            ApplyPilot information, navigates, submits, and continues to the next job in a new tab.
          </p>
          <p className="mt-1 text-[11px] text-amber-400/90">
            All unapplied jobs with a usable link are eligible. Unknown answers move the job to Needs review without stopping the queue.
          </p>
        </div>
        <button
          onClick={copyPrompt}
          disabled={active.length === 0}
          title="Copy the navigation prompt for the next twenty assigned applications"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-sky/30 bg-sky/10 px-3 py-2 text-[12px] font-medium text-sky transition-all hover:bg-sky/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {copied ? <ShieldCheck size={14} /> : <Copy size={14} />}
          {copied ? 'Prompt copied' : 'Copy AI batch prompt'}
        </button>
      </div>
    </div>
  );
}
