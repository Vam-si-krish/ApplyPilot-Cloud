'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Mail, RefreshCw, ExternalLink } from 'lucide-react';
import type { MailCategory, MailMessage } from '@/lib/types';

const ORDER: MailCategory[] = ['applied', 'shortlisted', 'action_needed', 'assessment', 'rejection', 'other'];
const META: Record<MailCategory, { label: string; cls: string }> = {
  applied: { label: 'Applied', cls: 'bg-sky/10 border-sky/25 text-sky' },
  shortlisted: { label: 'Shortlisted', cls: 'bg-emerald/10 border-emerald/25 text-emerald' },
  action_needed: { label: 'Action needed', cls: 'bg-amber-500/10 border-amber-500/25 text-amber-400' },
  assessment: { label: 'Assessment', cls: 'bg-violet-500/10 border-violet-500/25 text-violet-300' },
  rejection: { label: 'Rejection', cls: 'bg-rose/10 border-rose/30 text-rose' },
  other: { label: 'Other', cls: 'bg-raised border-ink text-slate-muted' },
};

interface MailData {
  connected: boolean;
  email: string | null;
  last_synced_at: string | null;
  messages: MailMessage[];
  daily: { date: string; counts: Record<string, number> }[];
  totals: Record<string, number>;
}

export default function InboxPage() {
  const [data, setData] = useState<MailData | null>(null);
  const [category, setCategory] = useState<MailCategory | 'all'>('all');
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const p = category === 'all' ? '' : `?category=${category}`;
    try {
      const d = await fetch(`/api/mail${p}`).then((r) => r.json());
      setData(d);
    } catch {
      /* ignore */
    }
  }, [category]);

  useEffect(() => {
    load();
  }, [load]);

  async function syncNow() {
    setSyncing(true);
    setMsg('Fetching and classifying new mail…');
    try {
      const d = await fetch('/api/gmail/sync', { method: 'POST' }).then((r) => r.json());
      if (d.ok) setMsg(d.reason === 'not_connected' ? 'Connect Gmail in Settings first.' : `Classified ${d.classified ?? 0} new email${d.classified === 1 ? '' : 's'}.`);
      else setMsg(d.error || 'Sync failed.');
      await load();
    } catch {
      setMsg('Sync failed.');
    } finally {
      setSyncing(false);
      setTimeout(() => setMsg(null), 6000);
    }
  }

  const totals = data?.totals ?? {};

  return (
    <div className="p-7 animate-slide-up">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-text tracking-tight flex items-center gap-2">
            <Mail size={20} className="text-sky" /> Inbox
          </h1>
          <p className="text-slate-muted text-[13px] mt-1">
            {data?.connected ? (
              <>AI-sorted job mail{data.email ? ` · ${data.email}` : ''}{data.last_synced_at ? ` · synced ${new Date(data.last_synced_at).toLocaleTimeString()}` : ''}</>
            ) : (
              <>Not connected — set it up in Settings → Gmail Inbox</>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {msg && <span className="text-[12px] text-slate-muted animate-fade-in">{msg}</span>}
          {data?.connected && (
            <button
              onClick={syncNow}
              disabled={syncing}
              className="flex items-center gap-1.5 px-3.5 py-2 text-[13px] font-medium text-sky bg-sky/10 border border-sky/30 hover:bg-sky/20 disabled:opacity-40 rounded-lg transition-all"
            >
              <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} /> {syncing ? 'Syncing…' : 'Sync now'}
            </button>
          )}
        </div>
      </div>

      {data && !data.connected ? (
        <div className="bg-card border border-ink rounded-xl px-6 py-12 text-center">
          <div className="w-12 h-12 rounded-xl bg-sky/10 border border-sky/20 flex items-center justify-center mx-auto mb-4">
            <Mail size={22} className="text-sky" />
          </div>
          <p className="text-slate-text text-[14px] font-medium mb-1">Connect your Gmail</p>
          <p className="text-slate-muted text-[12px] mb-5">Auto-sort applications, interviews, assessments, and rejections — with a daily count.</p>
          <Link href="/settings" className="inline-flex px-4 py-2 text-[13px] font-medium text-sky bg-sky/10 border border-sky/30 hover:bg-sky/20 rounded-lg transition-all">
            Go to Settings → Gmail
          </Link>
        </div>
      ) : (
        <>
          {/* Category filter with counts */}
          <div className="flex flex-wrap gap-1.5 mb-5">
            <Chip active={category === 'all'} onClick={() => setCategory('all')} label="All" count={ORDER.reduce((n, c) => n + (totals[c] ?? 0), 0)} cls="bg-sky-glow text-sky border-sky/30" />
            {ORDER.map((c) => (
              <Chip key={c} active={category === c} onClick={() => setCategory(c)} label={META[c].label} count={totals[c] ?? 0} cls={META[c].cls} />
            ))}
          </div>

          {/* Daily history */}
          {data && data.daily.length > 0 && (
            <div className="bg-card border border-ink rounded-xl p-5 mb-6 overflow-x-auto">
              <h2 className="font-display text-[12px] font-semibold text-slate-muted uppercase tracking-wider mb-3">Daily history</h2>
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-slate-muted text-left">
                    <th className="font-medium pb-2 pr-4">Date</th>
                    {ORDER.map((c) => (
                      <th key={c} className="font-medium pb-2 px-2 text-center whitespace-nowrap">{META[c].label}</th>
                    ))}
                    <th className="font-medium pb-2 pl-2 text-center">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {data.daily.slice(0, 14).map((d) => (
                    <tr key={d.date} className="border-t border-ink-subtle">
                      <td className="py-1.5 pr-4 text-slate-text font-medium whitespace-nowrap">
                        {new Date(d.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </td>
                      {ORDER.map((c) => (
                        <td key={c} className="py-1.5 px-2 text-center font-mono text-slate-muted">{d.counts[c] || ''}</td>
                      ))}
                      <td className="py-1.5 pl-2 text-center font-mono text-slate-text">{d.counts.total || 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Message list */}
          <div className="bg-card border border-ink rounded-xl overflow-hidden">
            {!data ? (
              <div className="px-5 py-10 text-center text-slate-muted text-[13px]">Loading…</div>
            ) : data.messages.length === 0 ? (
              <div className="px-5 py-10 text-center text-slate-muted text-[13px]">
                No mail here yet. Hit <span className="text-sky">Sync now</span> to pull recent emails.
              </div>
            ) : (
              <div className="divide-y divide-ink-subtle">
                {data.messages.map((m) => (
                  <div key={m.id} className="flex items-start gap-3 px-5 py-3 hover:bg-raised transition-colors">
                    <span className={`shrink-0 mt-0.5 px-1.5 py-0.5 text-[10px] font-medium rounded border ${META[m.category].cls}`}>{META[m.category].label}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-slate-text text-[13px] font-medium truncate">{m.subject || '(no subject)'}</p>
                      <p className="text-slate-muted text-[11px] truncate">
                        {m.from_name || m.from_email}
                        {m.summary ? <span className="text-slate-muted/80"> — {m.summary}</span> : ''}
                      </p>
                    </div>
                    <span className="shrink-0 text-[11px] text-slate-muted">{m.received_at ? new Date(m.received_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}</span>
                    {m.thread_id && (
                      <a href={`https://mail.google.com/mail/u/0/#all/${m.thread_id}`} target="_blank" rel="noopener noreferrer" title="Open in Gmail" className="shrink-0 text-slate-muted hover:text-sky">
                        <ExternalLink size={14} />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Chip({ active, onClick, label, count, cls }: { active: boolean; onClick: () => void; label: string; count: number; cls: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 text-[12px] rounded-md border transition-all ${
        active ? cls : 'text-slate-muted border-ink hover:text-slate-text hover:bg-raised'
      }`}
    >
      {label}
      <span className={`font-mono ${active ? '' : 'text-slate-muted'}`}>{count}</span>
    </button>
  );
}
