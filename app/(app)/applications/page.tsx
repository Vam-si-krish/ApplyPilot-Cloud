'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, Trash2, CheckCircle2, FileText, Briefcase, Clock } from 'lucide-react';
import BaseResumeEditor from '@/components/BaseResumeEditor';
import type { ApplicationWithJob, ApplicationStatus } from '@/lib/types';

type View = 'list' | 'base';

const STATUS_STYLE: Record<ApplicationStatus, string> = {
  queued: 'bg-raised border-ink text-slate-muted',
  generating: 'bg-sky/10 border-sky/30 text-sky',
  ready: 'bg-violet-500/10 border-violet-500/30 text-violet-300',
  applied: 'bg-emerald/10 border-emerald/30 text-emerald',
  failed: 'bg-rose/10 border-rose/30 text-rose',
};

export default function ApplicationsPage() {
  const [view, setView] = useState<View>('list');
  const [apps, setApps] = useState<ApplicationWithJob[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await fetch('/api/applications').then((r) => r.json());
      setApps(d.applications ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function patch(id: string, body: Record<string, unknown>) {
    await fetch(`/api/applications/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    load();
  }

  async function remove(id: string) {
    if (!confirm('Remove this application?')) return;
    await fetch(`/api/applications/${id}`, { method: 'DELETE' });
    load();
  }

  return (
    <div className="p-4 sm:p-6 lg:p-7 animate-slide-up">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold text-slate-text tracking-tight">Applications</h1>
        <p className="text-slate-muted text-[13px] mt-0.5">
          Shortlisted jobs you&apos;re preparing tailored résumés for. Add jobs from the{' '}
          <Link href="/jobs" className="text-sky hover:underline">Jobs</Link> tab.
        </p>
      </div>

      <div className="flex gap-1 mb-5 border-b border-ink">
        {([
          { id: 'list' as View, label: 'Applications' },
          { id: 'base' as View, label: 'Base résumé' },
        ]).map((t) => (
          <button
            key={t.id}
            onClick={() => setView(t.id)}
            className={`px-4 py-2 text-[13px] font-medium border-b-2 -mb-px transition-all ${
              view === t.id ? 'border-sky text-sky' : 'border-transparent text-slate-muted hover:text-slate-text'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {view === 'base' ? (
        <BaseResumeEditor />
      ) : loading ? (
        <div className="bg-card border border-ink rounded-xl px-5 py-10 text-center text-slate-muted text-[13px]">Loading…</div>
      ) : apps.length === 0 ? (
        <div className="bg-card border border-ink rounded-xl px-6 py-14 text-center">
          <FileText size={22} className="mx-auto text-slate-muted mb-3" />
          <h3 className="text-[14px] font-medium text-slate-text mb-1">No applications yet</h3>
          <p className="text-[13px] text-slate-muted max-w-md mx-auto mb-5">
            On the Jobs tab, select the roles you want to apply to and use <span className="text-sky">Add to Applications</span>.
            They&apos;ll appear here, ready for a tailored résumé.
          </p>
          <Link
            href="/jobs"
            className="inline-flex items-center gap-1.5 px-4 py-2 text-[13px] font-medium text-sky bg-sky/10 border border-sky/30 hover:bg-sky/20 rounded-lg transition-all"
          >
            <Briefcase size={14} /> Go to Jobs
          </Link>
        </div>
      ) : (
        <div className="bg-card border border-ink rounded-xl overflow-hidden divide-y divide-ink-subtle">
          {apps.map((a) => {
            const job = a.job;
            return (
              <div key={a.id} className="flex items-center gap-4 px-5 py-3 hover:bg-raised transition-colors">
                <span className={`shrink-0 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider rounded border ${STATUS_STYLE[a.status]}`}>
                  {a.status}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-slate-text text-[13px] font-medium truncate">{job?.title ?? 'Job removed'}</p>
                  <p className="text-slate-muted text-[11px] truncate">
                    {job?.company ?? '—'}
                    {job?.location ? ` · ${job.location}` : ''}
                    {typeof job?.fit_score === 'number' ? ` · fit ${job.fit_score}/10` : ''}
                  </p>
                </div>
                <span className="hidden sm:flex items-center gap-1 text-slate-muted text-[11px] shrink-0">
                  <Clock size={11} /> {new Date(a.created_at).toLocaleDateString()}
                </span>
                {a.applied_at ? (
                  <span title={`Applied ${new Date(a.applied_at).toLocaleDateString()}`} className="text-emerald shrink-0">
                    <CheckCircle2 size={15} />
                  </span>
                ) : (
                  <button
                    onClick={() => patch(a.id, { status: 'applied' })}
                    title="Mark as applied"
                    className="text-slate-muted hover:text-emerald shrink-0"
                  >
                    <CheckCircle2 size={15} />
                  </button>
                )}
                {job && (
                  <a
                    href={job.application_url || job.url || '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Open posting"
                    className="text-slate-muted hover:text-sky shrink-0"
                  >
                    <ExternalLink size={15} />
                  </a>
                )}
                <button onClick={() => remove(a.id)} title="Remove application" className="text-slate-muted hover:text-rose shrink-0">
                  <Trash2 size={15} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {view === 'list' && apps.length > 0 && (
        <p className="text-[11px] text-slate-muted mt-4">
          Tailored-résumé generation arrives once the résumé worker is connected (ADR 0024). For now, manage your shortlist and
          keep the <button onClick={() => setView('base')} className="text-sky hover:underline">base résumé</button> current.
        </p>
      )}
    </div>
  );
}
