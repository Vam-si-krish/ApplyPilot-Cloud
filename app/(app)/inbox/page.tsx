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
const PENDING_META = { label: 'Pending', cls: 'bg-raised border-ink text-slate-muted animate-pulse' };

interface MailData {
  connected: boolean;
  email: string | null;
  last_synced_at: string | null;
  messages: MailMessage[];
  daily: { date: string; counts: Record<string, number> }[];
  totals: Record<string, number>;
  pending: number;
  applySources: { easy_apply: number; company_portal: number; unknown: number };
}

// Live sync progress shown while "Sync now" runs its fetch → classify loop.
type SyncProgress =
  | { phase: 'fetching'; found: number }
  | { phase: 'classifying'; done: number; total: number }
  | { phase: 'done'; total: number };

export default function InboxPage() {
  const [data, setData] = useState<MailData | null>(null);
  const [category, setCategory] = useState<MailCategory | 'all'>('all');
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState<SyncProgress | null>(null);
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

  // Drive the two-phase sync from the client so progress is visible in real time:
  //   1. /api/gmail/fetch in a loop until the whole window is stored ("N found"),
  //   2. /api/gmail/classify-batch in a loop until pending drains ("X of N").
  async function syncNow() {
    setSyncing(true);
    setMsg(null);

    const postJson = (url: string) => fetch(url, { method: 'POST' }).then((r) => r.json());

    try {
      // Phase 1 — fetch all new mail into the inbox (appears as "Pending").
      setProgress({ phase: 'fetching', found: 0 });
      let pending = 0;
      let found = 0;
      for (let i = 0; i < 80; i++) {
        const r = await postJson('/api/gmail/fetch');
        if (r.reason === 'not_connected') {
          setMsg('Connect Gmail in Settings first.');
          setProgress(null);
          return;
        }
        if (!r.ok) {
          setMsg(r.error || 'Fetch failed.');
          setProgress(null);
          return;
        }
        found = r.found ?? found;
        pending = r.pending ?? pending;
        setProgress({ phase: 'fetching', found });
        await load(); // newly fetched mail shows up immediately as "Pending"
        if (r.done) break;
      }

      // Phase 2 — classify the pending backlog one batch at a time.
      const total = pending;
      if (total === 0) {
        setProgress({ phase: 'done', total: 0 });
        setMsg('No new mail — you’re all caught up.');
        return;
      }
      let remaining = total;
      setProgress({ phase: 'classifying', done: 0, total });
      for (let i = 0; i < 200 && remaining > 0; i++) {
        const r = await postJson('/api/gmail/classify-batch');
        if (!r.ok) break;
        remaining = r.remaining ?? 0;
        setProgress({ phase: 'classifying', done: total - remaining, total });
        await load(); // categories light up live as the AI works through them
        if (r.done) break;
      }
      setProgress({ phase: 'done', total });
      setMsg(`Done — classified ${total} new email${total === 1 ? '' : 's'}.`);
    } catch {
      setMsg('Sync failed.');
    } finally {
      setSyncing(false);
      await load();
      setTimeout(() => {
        setMsg(null);
        setProgress(null);
      }, 6000);
    }
  }

  const totals = data?.totals ?? {};
  const src = data?.applySources ?? { easy_apply: 0, company_portal: 0, unknown: 0 };

  return (
    <div className="p-7 animate-slide-up">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-text tracking-tight flex items-center gap-2">
            <Mail size={20} className="text-sky" /> Inbox
          </h1>
          <p className="text-slate-muted text-[13px] mt-1">
            {data?.connected ? (
              <>AI-sorted job mail{data.email ? ` · ${data.email}` : ''}{data.last_synced_at ? ` · synced ${new Date(data.last_synced_at).toLocaleTimeString()}` : ''}{data.pending > 0 ? ` · ${data.pending} awaiting AI` : ''}</>
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

      {/* Live sync progress: fetching new mail, then AI classifying it. */}
      {progress && <SyncProgressPanel progress={progress} />}

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

          {/* How you applied: LinkedIn Easy Apply vs company / ATS portal (ADR 0021) */}
          {(totals.applied ?? 0) > 0 && (
            <div className="flex flex-wrap items-center gap-4 mb-6 bg-card border border-ink rounded-xl px-4 py-3">
              <span className="text-[12px] text-slate-muted uppercase tracking-wider font-medium">Applied via</span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-sky" />
                <span className="font-display text-lg font-bold text-sky">{src.easy_apply}</span>
                <span className="text-[12px] text-slate-muted">Easy Apply</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald" />
                <span className="font-display text-lg font-bold text-emerald">{src.company_portal}</span>
                <span className="text-[12px] text-slate-muted">Company portal</span>
              </span>
              {src.unknown > 0 && <span className="text-[12px] text-slate-muted">· {src.unknown} unspecified</span>}
            </div>
          )}

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
                {data.messages.map((m) => {
                  const meta = m.category ? META[m.category] : PENDING_META;
                  return (
                  <div key={m.id} className="flex items-start gap-3 px-5 py-3 hover:bg-raised transition-colors">
                    <span className={`shrink-0 mt-0.5 px-1.5 py-0.5 text-[10px] font-medium rounded border ${meta.cls}`}>{meta.label}</span>
                    {m.category === 'applied' && m.apply_source && (
                      <span
                        title={m.apply_source === 'easy_apply' ? 'Applied via LinkedIn Easy Apply' : 'Applied on the company / ATS portal'}
                        className={`shrink-0 mt-0.5 px-1.5 py-0.5 text-[9px] font-medium rounded border ${
                          m.apply_source === 'easy_apply' ? 'bg-sky/10 border-sky/25 text-sky' : 'bg-emerald/10 border-emerald/25 text-emerald'
                        }`}
                      >
                        {m.apply_source === 'easy_apply' ? 'Easy Apply' : 'Portal'}
                      </span>
                    )}
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
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function SyncProgressPanel({ progress }: { progress: SyncProgress }) {
  const pct =
    progress.phase === 'classifying' && progress.total > 0
      ? Math.round((progress.done / progress.total) * 100)
      : progress.phase === 'done'
      ? 100
      : null;
  const line =
    progress.phase === 'fetching'
      ? `Fetching new mail from Gmail… ${progress.found} found`
      : progress.phase === 'classifying'
      ? `AI is reading your mail — ${progress.done} of ${progress.total} classified`
      : progress.total === 0
      ? 'All caught up — no new mail.'
      : `Done — ${progress.total} email${progress.total === 1 ? '' : 's'} classified.`;
  return (
    <div className="bg-card border border-ink rounded-xl px-5 py-4 mb-5 animate-fade-in">
      <div className="flex items-center gap-2 mb-2">
        <RefreshCw size={13} className={progress.phase === 'done' ? 'text-emerald' : 'text-sky animate-spin'} />
        <span className="text-[13px] text-slate-text font-medium">{line}</span>
      </div>
      <div className="h-1.5 w-full bg-raised rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${progress.phase === 'done' ? 'bg-emerald' : 'bg-sky'} ${pct === null ? 'animate-pulse w-1/3' : ''}`}
          style={pct === null ? undefined : { width: `${pct}%` }}
        />
      </div>
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
