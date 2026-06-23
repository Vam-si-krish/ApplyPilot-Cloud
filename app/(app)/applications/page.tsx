'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, Trash2, CheckCircle2, FileText, Briefcase, Clock, ChevronDown, ChevronRight, Sparkles, Save, AlertCircle, FileDown, Download } from 'lucide-react';
import BaseResumeEditor from '@/components/BaseResumeEditor';
import ManualGenerate from '@/components/ManualGenerate';
import ResumeFields from '@/components/ResumeFields';
import ChangesReview, { confirmTailorChanges } from '@/components/ChangesReview';
import type { ApplicationWithJob, ApplicationStatus, ResumeDoc } from '@/lib/types';

type View = 'list' | 'base' | 'manual';

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
  const [expanded, setExpanded] = useState<string | null>(null);
  const [genId, setGenId] = useState<string | null>(null); // application currently generating
  const [msg, setMsg] = useState<string | null>(null);

  // Local editable draft of the expanded application's tailored résumé.
  const [draft, setDraft] = useState<ResumeDoc | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [rendering, setRendering] = useState<string | null>(null); // application currently rendering a PDF

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

  function toggleExpand(a: ApplicationWithJob) {
    if (expanded === a.id) {
      setExpanded(null);
      setDraft(null);
    } else {
      setExpanded(a.id);
      setDraft(a.tailored_resume ? structuredClone(a.tailored_resume) : null);
    }
  }

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
    if (expanded === id) setExpanded(null);
    load();
  }

  // Fetch a single application's current row from the list endpoint (used to poll
  // for the worker's async tailoring result).
  async function fetchApp(id: string): Promise<ApplicationWithJob | null> {
    const d = await fetch('/api/applications').then((r) => r.json());
    return (d.applications ?? []).find((x: ApplicationWithJob) => x.id === id) ?? null;
  }

  async function generate(a: ApplicationWithJob) {
    if (genId) return;
    setGenId(a.id);
    setMsg('Generating tailored résumé… this can take up to a minute.');
    try {
      // The generate route hands off to the worker and returns 202 immediately;
      // the worker writes the result to the row, so we poll the row for status.
      const r = await fetch(`/api/applications/${a.id}/generate`, { method: 'POST' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg(`Generation failed: ${d.error || 'unknown error'}`);
        load();
        return;
      }

      // Poll until the worker marks the row ready/failed (cap ~3 min).
      const deadline = Date.now() + 180_000;
      let row: ApplicationWithJob | null = null;
      while (Date.now() < deadline) {
        await new Promise((res) => setTimeout(res, 2500));
        row = await fetchApp(a.id).catch(() => null);
        if (row && (row.status === 'ready' || row.status === 'failed')) break;
      }

      if (row?.status === 'ready') {
        setMsg('Tailored résumé generated — review and edit below.');
        setExpanded(a.id);
        setDraft(row.tailored_resume ? structuredClone(row.tailored_resume) : null);
      } else if (row?.status === 'failed') {
        setMsg(`Generation failed: ${row.error || 'unknown error'}`);
      } else {
        setMsg('Still generating — refresh in a moment to see the result.');
      }
      load();
    } catch {
      setMsg('Generation failed.');
    } finally {
      setGenId(null);
      setTimeout(() => setMsg(null), 6000);
    }
  }

  async function saveDraft(id: string) {
    if (!draft) return;
    setSavingDraft(true);
    try {
      await fetch(`/api/applications/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tailored_resume: draft }),
      });
      setMsg('Saved.');
      load();
    } finally {
      setSavingDraft(false);
      setTimeout(() => setMsg(null), 3000);
    }
  }

  async function setTemplate(id: string, template: string) {
    setApps((prev) => prev.map((x) => (x.id === id ? { ...x, template } : x)));
    await fetch(`/api/applications/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template }),
    });
  }

  // Ask the résumé worker to render the tailored résumé to a one-page PDF.
  async function renderPdf(a: ApplicationWithJob) {
    if (rendering) return;
    // Make the user confirm anything the AI added/embellished before producing the PDF.
    if (!confirmTailorChanges(a.tailor_changes)) return;
    setRendering(a.id);
    setMsg('Rendering PDF…');
    try {
      const r = await fetch(`/api/applications/${a.id}/render`, { method: 'POST' });
      const d = await r.json();
      if (!r.ok) {
        setMsg(`PDF render failed: ${d.error || 'unknown error'}`);
      } else {
        setMsg(d.tooLong ? 'PDF ready — content was long, trimmed to one page (consider shortening).' : `PDF ready (1 page).`);
      }
      load();
    } catch {
      setMsg('PDF render failed.');
    } finally {
      setRendering(null);
      setTimeout(() => setMsg(null), 7000);
    }
  }

  // Open the generated PDF via a short-lived signed URL.
  async function downloadPdf(id: string) {
    try {
      const d = await fetch(`/api/applications/${id}/pdf`).then((r) => r.json());
      if (d.url) window.open(d.url, '_blank', 'noopener');
      else setMsg(d.error || 'No PDF available.');
    } catch {
      setMsg('Could not open the PDF.');
    }
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
          { id: 'manual' as View, label: 'Quick Generate' },
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

      {msg && <div className="mb-3 text-[12px] text-slate-muted animate-fade-in">{msg}</div>}

      {view === 'manual' ? (
        <ManualGenerate />
      ) : view === 'base' ? (
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
            const open = expanded === a.id;
            const generating = genId === a.id || a.status === 'generating';
            return (
              <div key={a.id}>
                <div className="flex items-center gap-3 px-5 py-3 hover:bg-raised transition-colors">
                  <button onClick={() => toggleExpand(a)} className="text-slate-muted hover:text-sky shrink-0">
                    {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                  </button>
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
                  <button
                    onClick={() => generate(a)}
                    disabled={!!genId || !job}
                    title="Generate a job-tailored résumé from your base résumé (truthful reframing)"
                    className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] font-medium text-violet-300 bg-violet-500/10 border border-violet-500/30 hover:bg-violet-500/20 disabled:opacity-40 rounded-md transition-all shrink-0"
                  >
                    <Sparkles size={12} /> {generating ? 'Generating…' : a.tailored_resume ? 'Regenerate' : 'Generate'}
                  </button>
                  <span className="hidden md:flex items-center gap-1 text-slate-muted text-[11px] shrink-0">
                    <Clock size={11} /> {new Date(a.created_at).toLocaleDateString()}
                  </span>
                  {a.applied_at ? (
                    <span title={`Applied ${new Date(a.applied_at).toLocaleDateString()}`} className="text-emerald shrink-0">
                      <CheckCircle2 size={15} />
                    </span>
                  ) : (
                    <button onClick={() => patch(a.id, { status: 'applied' })} title="Mark as applied" className="text-slate-muted hover:text-emerald shrink-0">
                      <CheckCircle2 size={15} />
                    </button>
                  )}
                  {job && (
                    <a href={job.application_url || job.url || '#'} target="_blank" rel="noopener noreferrer" title="Open posting" className="text-slate-muted hover:text-sky shrink-0">
                      <ExternalLink size={15} />
                    </a>
                  )}
                  <button onClick={() => remove(a.id)} title="Remove application" className="text-slate-muted hover:text-rose shrink-0">
                    <Trash2 size={15} />
                  </button>
                </div>

                {open && (
                  <div className="px-5 pb-5 pt-1 bg-base/40">
                    {a.status === 'failed' && a.error && (
                      <div className="flex items-start gap-2 px-3 py-2 mb-3 text-[12px] text-rose bg-rose/10 border border-rose/30 rounded-lg">
                        <AlertCircle size={14} className="mt-0.5 shrink-0" /> {a.error}
                      </div>
                    )}
                    {/* Mobile generate button (the row one is hidden on small screens) */}
                    <button
                      onClick={() => generate(a)}
                      disabled={!!genId || !job}
                      className="sm:hidden mb-3 flex items-center gap-1.5 px-3 py-2 text-[12px] font-medium text-violet-300 bg-violet-500/10 border border-violet-500/30 hover:bg-violet-500/20 disabled:opacity-40 rounded-md transition-all"
                    >
                      <Sparkles size={12} /> {generating ? 'Generating…' : a.tailored_resume ? 'Regenerate résumé' : 'Generate résumé'}
                    </button>

                    {draft ? (
                      <>
                        <div className="mb-3">
                          <ChangesReview changes={a.tailor_changes} />
                        </div>
                        <div className="flex items-center justify-between mb-3">
                          <p className="text-[12px] text-slate-muted">Tailored résumé — edit freely, then create the PDF.</p>
                        </div>
                        <ResumeFields value={draft} onChange={setDraft} />
                        <div className="flex items-center gap-3 mt-4">
                          <button
                            onClick={() => saveDraft(a.id)}
                            disabled={savingDraft}
                            className="flex items-center gap-2 px-4 py-2 bg-sky/10 text-sky border border-sky/30 hover:bg-sky/20 disabled:opacity-40 rounded-lg text-[13px] font-medium transition-all"
                          >
                            <Save size={14} /> {savingDraft ? 'Saving…' : 'Save changes'}
                          </button>
                        </div>

                        {/* PDF — render a polished one-page, ATS-readable PDF via the résumé worker */}
                        <div className="mt-5 pt-4 border-t border-ink-subtle flex flex-wrap items-center gap-3">
                          <span className="text-[12px] text-slate-muted">PDF:</span>
                          <select
                            value={a.template || 'classic'}
                            onChange={(e) => setTemplate(a.id, e.target.value)}
                            title="Résumé template"
                            className="px-2.5 py-1.5 bg-card border border-ink rounded-md text-[12px] text-slate-text outline-none focus:border-sky/40"
                          >
                            <option value="classic">Classic (serif)</option>
                            <option value="modern">Modern (sans)</option>
                          </select>
                          <button
                            onClick={() => renderPdf(a)}
                            disabled={rendering === a.id}
                            title="Render the tailored résumé to a one-page PDF (saves the latest edits first is recommended)"
                            className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-violet-300 bg-violet-500/10 border border-violet-500/30 hover:bg-violet-500/20 disabled:opacity-40 rounded-md transition-all"
                          >
                            <FileDown size={13} /> {rendering === a.id ? 'Rendering…' : a.pdf_path ? 'Re-render PDF' : 'Create PDF'}
                          </button>
                          {a.pdf_path && (
                            <button
                              onClick={() => downloadPdf(a.id)}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-emerald border border-emerald/30 bg-emerald/10 hover:bg-emerald/20 rounded-md transition-all"
                            >
                              <Download size={13} /> Download PDF
                            </button>
                          )}
                          <span className="text-[11px] text-slate-muted">Re-render after edits to refresh the PDF.</span>
                        </div>
                      </>
                    ) : (
                      <p className="text-[12px] text-slate-muted py-2">
                        No tailored résumé yet. Click <span className="text-violet-300">Generate</span> to reframe your base
                        résumé for <span className="text-slate-text">{job?.title ?? 'this job'}</span>.{' '}
                        {' '}Make sure your <button onClick={() => setView('base')} className="text-sky hover:underline">base résumé</button> is set first.
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {view === 'list' && apps.length > 0 && (
        <p className="text-[11px] text-slate-muted mt-4">
          Generation reframes your real experience for each job (never fabricated). Keep your{' '}
          <button onClick={() => setView('base')} className="text-sky hover:underline">base résumé</button> current for the best results.
        </p>
      )}
    </div>
  );
}
