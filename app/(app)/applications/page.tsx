'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, Trash2, CheckCircle2, FileText, Briefcase, Clock, ChevronDown, ChevronRight, Sparkles, Save, AlertCircle, FileDown, Download, Loader2, Plus, Search } from 'lucide-react';
import BaseResumeEditor from '@/components/BaseResumeEditor';
import ManualGenerate from '@/components/ManualGenerate';
import ResumeFields from '@/components/ResumeFields';
import ChangesReview, { confirmTailorChanges } from '@/components/ChangesReview';
import CompanyTierBadge from '@/components/CompanyTierBadge';
import { useProgress } from '@/components/ProgressContext';
import type { ApplicationWithJob, ApplicationStatus, ResumeDoc } from '@/lib/types';

type View = 'list' | 'base' | 'manual';

const STATUS_STYLE: Record<ApplicationStatus, string> = {
  queued: 'bg-raised border-ink text-slate-muted',
  generating: 'bg-sky/10 border-sky/30 text-sky',
  ready: 'bg-violet-500/10 border-violet-500/30 text-violet-300',
  applied: 'bg-emerald/10 border-emerald/30 text-emerald',
  failed: 'bg-rose/10 border-rose/30 text-rose',
};

// Status tabs for the Tailor & Apply list (parity with the Jobs tab's status filter).
const STATUS_FILTERS: Array<'all' | ApplicationStatus> = ['all', 'queued', 'generating', 'ready', 'applied', 'failed'];

// How many résumés to generate at once in "Generate selected". Each app is an
// independent worker pipeline (tailor → score → render); running a few in parallel is a
// big latency win. Kept modest so the single résumé worker (LLM call + Puppeteer render)
// isn't overwhelmed.
const GEN_CONCURRENCY = 3;

export default function ApplicationsPage() {
  const [view, setView] = useState<View>('list');
  const [apps, setApps] = useState<ApplicationWithJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [genId, setGenId] = useState<string | null>(null); // application currently generating
  const [genCoverId, setGenCoverId] = useState<string | null>(null); // application whose cover letter is generating
  const [msg, setMsg] = useState<string | null>(null);

  // Filters (parity with the Jobs tab — the subset that maps to applications).
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | ApplicationStatus>('all');
  const [hideApplied, setHideApplied] = useState(true);

  // Local editable draft of the expanded application's tailored résumé.
  const [draft, setDraft] = useState<ResumeDoc | null>(null);
  // Custom tailoring instructions for the expanded app (ADR 0037) — extra guidance the
  // AI applies on top of the job description (e.g. a recruiter's ask). Seeded on expand.
  const [instructions, setInstructions] = useState('');
  const [savingDraft, setSavingDraft] = useState(false);
  const [rendering, setRendering] = useState<string | null>(null); // application currently rendering a PDF
  const [scoringTailored, setScoringTailored] = useState<string | null>(null); // application whose tailored résumé is being scored
  // "Did you apply?" tracking — parity with the Jobs tab. The external apply link is a
  // real <a target="_blank">; on return to the tab we ask whether they applied.
  const pendingApply = useRef<ApplicationWithJob | null>(null);
  const [applyDialog, setApplyDialog] = useState<ApplicationWithJob | null>(null);

  // Bulk generate — select multiple applications and tailor résumés for all at once.
  // The progress toast lives in the shared provider so it stays pinned across tab
  // switches while the (still-running) generation loop works in the background.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const { setProgress: setBulkProgress, running: bulkRunning } = useProgress();

  // "Add custom job" — manually enter a job (e.g. from an email) to tailor a résumé to it.
  const [showCustom, setShowCustom] = useState(false);
  const [customForm, setCustomForm] = useState({ title: '', company: '', url: '', description: '' });
  const [savingCustom, setSavingCustom] = useState(false);
  const resetCustom = () => setCustomForm({ title: '', company: '', url: '', description: '' });

  async function addCustomJob() {
    if (!customForm.title.trim() || !customForm.description.trim() || savingCustom) return;
    setSavingCustom(true);
    setMsg(null);
    try {
      const r = await fetch('/api/applications/custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(customForm),
      });
      const d = await r.json();
      if (!r.ok) {
        setMsg(d.error || 'Could not add the job.');
        return;
      }
      resetCustom();
      setShowCustom(false);
      await load(true);
      setMsg('Custom job added — open it below and Generate a tailored résumé.');
    } catch {
      setMsg('Could not add the job.');
    } finally {
      setSavingCustom(false);
    }
  }

  // `silent` re-fetches the list in place without flipping the full-page "Loading…"
  // state — this is what kills the post-generate / post-PDF flicker (the list and the
  // open editor stay mounted; only changed rows re-render).
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const d = await fetch('/api/applications').then((r) => r.json());
      setApps(d.applications ?? []);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Ask "did you apply?" when the user returns after opening the posting.
  useEffect(() => {
    function onVisible() {
      if (!document.hidden && pendingApply.current) {
        setApplyDialog(pendingApply.current);
        pendingApply.current = null;
      }
    }
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  // Clear the selection whenever the filters change (the visible rows change).
  useEffect(() => {
    setSelected(new Set());
  }, [search, statusFilter, hideApplied]);

  function toggleExpand(a: ApplicationWithJob) {
    if (expanded === a.id) {
      setExpanded(null);
      setDraft(null);
      setInstructions('');
    } else {
      setExpanded(a.id);
      setDraft(a.tailored_resume ? structuredClone(a.tailored_resume) : null);
      setInstructions(a.tailor_instructions ?? '');
    }
  }

  async function patch(id: string, body: Record<string, unknown>) {
    await fetch(`/api/applications/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    load(true);
  }

  async function remove(id: string) {
    if (!confirm('Remove this application?')) return;
    await fetch(`/api/applications/${id}`, { method: 'DELETE' });
    if (expanded === id) setExpanded(null);
    setSelected((prev) => { const next = new Set(prev); next.delete(id); return next; });
    load(true);
  }

  // Bulk-delete every selected application — any row, including ones whose job was
  // removed (those are exactly the clutter worth clearing). Mirrors the Jobs tab.
  async function deleteSelected() {
    const ids = [...selected];
    if (ids.length === 0 || bulkBusy) return;
    if (!confirm(`Remove the ${ids.length} selected application${ids.length === 1 ? '' : 's'}? This can't be undone.`)) return;
    setBulkBusy(true);
    try {
      await Promise.all(ids.map((id) => fetch(`/api/applications/${id}`, { method: 'DELETE' })));
      if (expanded && ids.includes(expanded)) setExpanded(null);
      setSelected(new Set());
      setMsg(`Removed ${ids.length} application${ids.length === 1 ? '' : 's'}.`);
      load(true);
    } catch {
      setMsg('Could not remove the selected applications.');
    } finally {
      setBulkBusy(false);
      setTimeout(() => setMsg(null), 4000);
    }
  }

  // Trigger the overnight tailoring drain right now (same pipeline the 4am cron runs).
  // The worker acks immediately and drains every 'queued' application in the background;
  // rows light up as each finishes via the normal status polling. Use this to test the
  // queue without waiting for the scheduled time.
  async function runQueueNow() {
    if (bulkBusy || bulkRunning || genId) return;
    setBulkBusy(true);
    setMsg(null);
    try {
      const r = await fetch('/api/tailor-queue', { method: 'POST' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg(d.error || 'Could not start the queue.');
      } else if ((d.processing ?? 0) === 0) {
        setMsg('Nothing queued to tailor.');
      } else {
        setMsg(`Tailoring ${d.processing} queued résumé${d.processing === 1 ? '' : 's'} in the background — they’ll appear as each finishes.`);
      }
      load(true);
    } catch {
      setMsg('Could not reach the server to start the queue.');
    } finally {
      setBulkBusy(false);
      setTimeout(() => setMsg(null), 6000);
    }
  }

  // Fetch a single application's current row from the list endpoint (used to poll
  // for the worker's async tailoring result).
  async function fetchApp(id: string): Promise<ApplicationWithJob | null> {
    const d = await fetch('/api/applications').then((r) => r.json());
    return (d.applications ?? []).find((x: ApplicationWithJob) => x.id === id) ?? null;
  }

  async function generate(a: ApplicationWithJob) {
    if (genId || bulkBusy) return;
    setGenId(a.id);
    setMsg('Generating tailored résumé… this can take up to a minute.');
    try {
      // If this app is open, persist the latest custom instructions first so the worker
      // (which reads them from the row) tailors with them. No-op when unchanged/empty.
      if (expanded === a.id) {
        await fetch(`/api/applications/${a.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tailor_instructions: instructions }),
        }).catch(() => {});
      }
      // The generate route hands off to the worker and returns 202 immediately;
      // the worker writes the result to the row, so we poll the row for status.
      const r = await fetch(`/api/applications/${a.id}/generate`, { method: 'POST' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg(`Generation failed: ${d.error || 'unknown error'}`);
        load(true);
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
        setMsg('Tailored résumé generated — scoring it against the job…');
        setExpanded(a.id);
        setDraft(row.tailored_resume ? structuredClone(row.tailored_resume) : null);
        // Score the new résumé so the row shows its fit vs the original (ADR 0029).
        await scoreTailored(a.id);
        // Auto-create the PDF so it's ready to download from the row — no second click.
        setRendering(a.id);
        setMsg('Tailored résumé ready — creating the PDF…');
        const pdf = await doRender(a.id);
        setRendering(null);
        setMsg(
          pdf.ok
            ? 'Résumé and PDF ready — download from the row, or review and edit below.'
            : `Résumé ready — PDF render failed: ${pdf.error}. Use “Create PDF” below to retry.`,
        );
      } else if (row?.status === 'failed') {
        setMsg(`Generation failed: ${row.error || 'unknown error'}`);
      } else {
        setMsg('Still generating — refresh in a moment to see the result.');
      }
      load(true);
    } catch {
      setMsg('Generation failed.');
    } finally {
      setGenId(null);
      setTimeout(() => setMsg(null), 6000);
    }
  }

  // ── Bulk generate ──────────────────────────────────────────────────────────
  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  // Visible (filtered) applications — the list, select-all, and bulk actions all
  // operate on this set, not the full one. Mirrors the Jobs tab's filtering.
  const q = search.trim().toLowerCase();
  const filtered = apps.filter((a) => {
    if (statusFilter !== 'all' && a.status !== statusFilter) return false;
    if (hideApplied && statusFilter !== 'applied' && a.status === 'applied') return false;
    if (q) {
      const hay = `${a.job?.title ?? ''} ${a.job?.company ?? ''} ${a.job?.location ?? ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  // Any visible row can be selected (so job-removed clutter is bulk-deletable);
  // Generate only acts on the ones that still have a job.
  const selectableIds = filtered.map((a) => a.id);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));
  const selectedGeneratable = [...selected].filter((id) => apps.find((a) => a.id === id)?.job).length;
  // Applications waiting to be tailored — what the overnight drain (and "Run queue now") acts on.
  const queuedCount = apps.filter((a) => a.status === 'queued' && a.job && !a.tailored_resume).length;
  function toggleSelectAll() {
    setSelected(allSelected ? new Set() : new Set(selectableIds));
  }

  // Generate tailored résumés for every selected application, a few at a time
  // (GEN_CONCURRENCY) since each is an independent pipeline, driving one shared progress
  // bar. Per app, it mirrors the single-generate flow: hand off → poll the row until
  // ready/failed → score the new résumé → auto-create the PDF.
  async function generateSelected() {
    if (bulkBusy || bulkRunning || genId) return;
    const ids = [...selected].filter((id) => apps.find((a) => a.id === id)?.job);
    if (ids.length === 0) return;
    setBulkBusy(true);
    setMsg(null);
    let done = 0;
    let ok = 0;
    let failed = 0;
    setBulkProgress({ label: 'Generating résumés & PDFs', done: 0, total: ids.length, phase: 'running', tone: 'violet' });

    // The full pipeline for one application. Self-contained so the pool can run several
    // at once. (No per-row render spinner here — multiple render concurrently; the shared
    // progress toast + each row's status cover the feedback.)
    async function processApp(id: string): Promise<void> {
      setApps((prev) => prev.map((x) => (x.id === id ? { ...x, status: 'generating' } : x)));
      try {
        const r = await fetch(`/api/applications/${id}/generate`, { method: 'POST' });
        if (!r.ok) {
          failed++;
        } else {
          // Poll the row until the worker marks it ready/failed (cap ~3 min each).
          const deadline = Date.now() + 180_000;
          let row: ApplicationWithJob | null = null;
          while (Date.now() < deadline) {
            await new Promise((res) => setTimeout(res, 2500));
            row = await fetchApp(id).catch(() => null);
            if (row && (row.status === 'ready' || row.status === 'failed')) break;
          }
          if (row?.status === 'ready') {
            ok++;
            // Score the new résumé against its job (parity with single generate, ADR 0029).
            await fetch(`/api/applications/${id}/score-tailored`, { method: 'POST' }).catch(() => {});
            // Auto-create the PDF too, so every generated résumé is download-ready.
            await doRender(id).catch(() => {});
          } else {
            failed++;
          }
        }
      } catch {
        failed++;
      }
      done++;
      setBulkProgress({ label: 'Generating résumés & PDFs', done, total: ids.length, phase: 'running', tone: 'violet' });
      load(true); // results light up live as each one lands
    }

    try {
      // Bounded-concurrency pool: up to GEN_CONCURRENCY pipelines in flight at once.
      const queue = [...ids];
      const runWorker = async () => {
        for (let id = queue.shift(); id; id = queue.shift()) {
          await processApp(id);
        }
      };
      await Promise.all(Array.from({ length: Math.min(GEN_CONCURRENCY, ids.length) }, runWorker));

      setBulkProgress({
        label: `Done — ${ok} generated${failed ? `, ${failed} failed` : ''}`,
        done: ids.length,
        total: ids.length,
        phase: 'done',
        tone: 'violet',
      });
      setSelected(new Set());
      load(true);
    } finally {
      setBulkBusy(false);
      setRendering(null);
    }
  }

  // Fit-score the application's tailored résumé against its job (ADR 0029).
  async function scoreTailored(id: string) {
    setScoringTailored(id);
    try {
      await fetch(`/api/applications/${id}/score-tailored`, { method: 'POST' });
      await load(true);
    } catch {
      /* non-fatal — the row just won't show a tailored score */
    } finally {
      setScoringTailored(null);
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
      load(true);
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

  // Core PDF render — proxies to the résumé worker. No UI side effects, so it can be
  // reused both by the manual button and the auto-render-after-generate flow.
  async function doRender(id: string): Promise<{ ok: boolean; tooLong?: boolean; error?: string }> {
    try {
      const r = await fetch(`/api/applications/${id}/render`, { method: 'POST' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return { ok: false, error: d.error || 'unknown error' };
      return { ok: true, tooLong: !!d.tooLong };
    } catch {
      return { ok: false, error: 'could not reach the résumé worker' };
    }
  }

  // Manual "Create / Re-render PDF" button — keeps the truthfulness confirm gate so the
  // user reviews any AI additions before deliberately (re)producing the PDF.
  async function renderPdf(a: ApplicationWithJob) {
    if (rendering) return;
    if (!confirmTailorChanges(a.tailor_changes)) return;
    setRendering(a.id);
    setMsg('Rendering PDF…');
    const res = await doRender(a.id);
    setMsg(
      res.ok
        ? res.tooLong
          ? 'PDF ready — content was long, trimmed to one page (consider shortening).'
          : 'PDF ready (1 page).'
        : `PDF render failed: ${res.error}`,
    );
    load(true);
    setRendering(null);
    setTimeout(() => setMsg(null), 7000);
  }

  // Download the generated PDF with a proper filename (ADR 0030). The signed URL sets
  // Content-Disposition: attachment; an <a download> click downloads it directly
  // instead of opening a blank preview tab.
  async function downloadPdf(id: string) {
    try {
      const d = await fetch(`/api/applications/${id}/pdf`).then((r) => r.json());
      if (!d.url) {
        setMsg(d.error || 'No PDF available.');
        return;
      }
      const a = document.createElement('a');
      a.href = d.url;
      if (d.filename) a.download = d.filename;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch {
      setMsg('Could not download the PDF.');
    }
  }

  // Download the cover-letter PDF via a signed URL with a proper filename (ADR 0035).
  async function downloadCoverPdf(id: string) {
    try {
      const d = await fetch(`/api/applications/${id}/cover-letter/pdf`).then((r) => r.json());
      if (!d.url) {
        setMsg(d.error || 'No cover letter available.');
        return;
      }
      const a = document.createElement('a');
      a.href = d.url;
      if (d.filename) a.download = d.filename;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch {
      setMsg('Could not download the cover letter.');
    }
  }

  // Generate a cover letter for one application: hand off to the worker (async), poll
  // the row until the PDF lands (or it errors), then auto-download it (one-click flow).
  async function generateCoverLetter(a: ApplicationWithJob) {
    if (genCoverId || !a.job) return;
    setGenCoverId(a.id);
    setMsg('Writing your cover letter… this can take up to a minute.');
    try {
      const r = await fetch(`/api/applications/${a.id}/cover-letter`, { method: 'POST' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg(`Cover letter failed: ${d.error || 'unknown error'}`);
        return;
      }
      // Poll until the worker writes the PDF path or an error (cap ~3 min).
      const deadline = Date.now() + 180_000;
      let row: ApplicationWithJob | null = null;
      while (Date.now() < deadline) {
        await new Promise((res) => setTimeout(res, 2500));
        row = await fetchApp(a.id).catch(() => null);
        if (row && (row.cover_letter_pdf_path || row.cover_letter_error)) break;
      }
      if (row?.cover_letter_pdf_path) {
        setMsg('Cover letter ready — downloading…');
        await downloadCoverPdf(a.id);
      } else if (row?.cover_letter_error) {
        setMsg(`Cover letter failed: ${row.cover_letter_error}`);
      } else {
        setMsg('Still writing — try the Cover letter button again in a moment.');
      }
      load(true);
    } catch {
      setMsg('Cover letter failed.');
    } finally {
      setGenCoverId(null);
      setTimeout(() => setMsg(null), 6000);
    }
  }

  return (
    <div className="p-4 sm:p-6 lg:p-7 animate-slide-up">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold text-slate-text tracking-tight">Tailor &amp; Apply</h1>
        <p className="text-slate-muted text-[13px] mt-0.5">
          Tailor a résumé for each shortlisted job, generate the PDF, then apply. Add jobs from the{' '}
          <Link href="/jobs" className="text-sky hover:underline">Jobs</Link> tab.
        </p>
      </div>

      <div className="flex gap-1 mb-5 border-b border-ink">
        {([
          { id: 'list' as View, label: 'Queue' },
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

      {view === 'list' && (
        <div className="mb-4">
          <button
            onClick={() => setShowCustom((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-slate-text border border-ink rounded-lg hover:bg-raised transition-all"
          >
            <Plus size={14} /> Add custom job
          </button>

          {showCustom && (
            <div className="mt-3 bg-card border border-ink rounded-xl p-4 animate-fade-in">
              <p className="text-[12px] text-slate-muted mb-3">
                Add a job you found yourself (e.g. from an email). <span className="text-slate-text">Company</span> and{' '}
                <span className="text-slate-text">link</span> are optional; the description is what the résumé is tailored to.
              </p>
              <div className="grid sm:grid-cols-2 gap-3 mb-3">
                <input
                  value={customForm.title}
                  onChange={(e) => setCustomForm({ ...customForm, title: e.target.value })}
                  placeholder="Job title *"
                  className="px-3 py-2 text-[13px] bg-void border border-ink rounded-lg text-slate-text placeholder:text-slate-muted focus:border-sky outline-none"
                />
                <input
                  value={customForm.company}
                  onChange={(e) => setCustomForm({ ...customForm, company: e.target.value })}
                  placeholder="Company (optional)"
                  className="px-3 py-2 text-[13px] bg-void border border-ink rounded-lg text-slate-text placeholder:text-slate-muted focus:border-sky outline-none"
                />
              </div>
              <input
                value={customForm.url}
                onChange={(e) => setCustomForm({ ...customForm, url: e.target.value })}
                placeholder="Job / apply link (optional)"
                className="w-full px-3 py-2 text-[13px] bg-void border border-ink rounded-lg text-slate-text placeholder:text-slate-muted focus:border-sky outline-none mb-3"
              />
              <textarea
                value={customForm.description}
                onChange={(e) => setCustomForm({ ...customForm, description: e.target.value })}
                placeholder="Paste the full job description *"
                rows={6}
                className="w-full px-3 py-2 text-[13px] bg-void border border-ink rounded-lg text-slate-text placeholder:text-slate-muted focus:border-sky outline-none mb-3 resize-y"
              />
              <div className="flex gap-2">
                <button
                  onClick={addCustomJob}
                  disabled={!customForm.title.trim() || !customForm.description.trim() || savingCustom}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-[13px] font-medium text-sky bg-sky/10 border border-sky/30 hover:bg-sky/20 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {savingCustom ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />} Add job
                </button>
                <button
                  onClick={() => { setShowCustom(false); resetCustom(); }}
                  className="px-4 py-2 text-[13px] text-slate-muted border border-ink rounded-lg hover:bg-raised transition-all"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {view === 'manual' ? (
        <ManualGenerate />
      ) : view === 'base' ? (
        <BaseResumeEditor />
      ) : loading ? (
        <div className="bg-card border border-ink rounded-xl px-5 py-10 text-center text-slate-muted text-[13px]">Loading…</div>
      ) : apps.length === 0 ? (
        <div className="bg-card border border-ink rounded-xl px-6 py-14 text-center">
          <FileText size={22} className="mx-auto text-slate-muted mb-3" />
          <h3 className="text-[14px] font-medium text-slate-text mb-1">Nothing queued yet</h3>
          <p className="text-[13px] text-slate-muted max-w-md mx-auto mb-5">
            On the Jobs tab, select the roles you want to apply to and use <span className="text-sky">Send to Tailor &amp; Apply</span>
            {' '}— or use <span className="text-sky">Add custom job</span> above to enter one yourself (e.g. from an email).
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
        <>
        {/* Filters — search, status, hide applied (the Jobs-tab subset that maps here) */}
        <div className="space-y-3 mb-4">
          <div className="relative max-w-md">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-muted" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search title, company, location…"
              className="pl-8 pr-3 py-1.5 w-full bg-card border border-ink rounded-md text-[13px] text-slate-text placeholder:text-slate-muted focus:border-sky/40 outline-none"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1 flex-wrap">
              {STATUS_FILTERS.map((st) => (
                <button
                  key={st}
                  onClick={() => setStatusFilter(st)}
                  className={`px-3 py-1.5 text-[12px] rounded-md border capitalize transition-all ${
                    statusFilter === st
                      ? st === 'applied'
                        ? 'bg-emerald/10 text-emerald border-emerald/30'
                        : 'bg-sky-glow text-sky border-sky/30'
                      : 'text-slate-muted border-ink hover:text-slate-text hover:bg-raised'
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>
            <span className="hidden sm:block w-px h-5 bg-ink mx-1" />
            <label
              title="Hide applications you've already applied to"
              className={`flex items-center gap-1.5 px-3 py-1.5 text-[12px] rounded-md border cursor-pointer select-none transition-all ${
                hideApplied && statusFilter !== 'applied' ? 'bg-sky-glow text-sky border-sky/30' : 'text-slate-muted border-ink hover:text-slate-text hover:bg-raised'
              } ${statusFilter === 'applied' ? 'opacity-40 pointer-events-none' : ''}`}
            >
              <input
                type="checkbox"
                checked={hideApplied && statusFilter !== 'applied'}
                onChange={(e) => setHideApplied(e.target.checked)}
                className="w-3.5 h-3.5 rounded border-ink text-sky focus:ring-sky bg-raised"
              />
              Hide applied
            </label>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="bg-card border border-ink rounded-xl px-6 py-12 text-center">
            <FileText size={20} className="mx-auto text-slate-muted mb-2" />
            <p className="text-[13px] text-slate-text mb-1">No applications match these filters.</p>
            <button
              onClick={() => { setSearch(''); setStatusFilter('all'); setHideApplied(false); }}
              className="text-[12px] text-sky hover:underline"
            >
              Clear filters
            </button>
          </div>
        ) : (
        <>
        {/* Bulk-select toolbar — pick applications and act on just those. */}
        <div className="flex items-center gap-3 mb-3 flex-wrap">
          <label className="flex items-center gap-2 text-[12px] text-slate-muted cursor-pointer select-none">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleSelectAll}
              disabled={bulkBusy}
              className="w-4 h-4 rounded border-ink text-sky focus:ring-sky bg-raised"
            />
            {selected.size > 0 ? `${selected.size} selected` : `Select all (${selectableIds.length})`}
          </label>
          {selected.size > 0 && (
            <button
              onClick={() => setSelected(new Set())}
              disabled={bulkBusy}
              className="text-[12px] text-slate-muted hover:text-slate-text underline disabled:opacity-40"
            >
              Clear
            </button>
          )}
          <button
            onClick={runQueueNow}
            disabled={bulkBusy || bulkRunning || !!genId || queuedCount === 0}
            title="Tailor, score, and render every queued application now (the same pipeline the overnight schedule runs)"
            className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-sky bg-sky/10 border border-sky/30 hover:bg-sky/20 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg transition-all"
          >
            <Clock size={13} /> Run queue now{queuedCount > 0 ? ` (${queuedCount})` : ''}
          </button>
          <button
            onClick={generateSelected}
            disabled={bulkBusy || bulkRunning || !!genId || selectedGeneratable === 0}
            title="Generate a tailored résumé for every selected application"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-violet-300 bg-violet-500/10 border border-violet-500/30 hover:bg-violet-500/20 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg transition-all"
          >
            {bulkBusy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
            {bulkBusy ? 'Generating…' : `Generate selected${selectedGeneratable > 0 ? ` (${selectedGeneratable})` : ''}`}
          </button>
          <button
            onClick={deleteSelected}
            disabled={bulkBusy || selected.size === 0}
            title="Remove the selected applications permanently"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-slate-muted border border-ink hover:text-rose hover:border-rose/30 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg transition-all"
          >
            <Trash2 size={13} /> Delete selected{selected.size > 0 ? ` (${selected.size})` : ''}
          </button>
        </div>
        <div className="bg-card border border-ink rounded-xl overflow-hidden divide-y divide-ink-subtle">
          {filtered.map((a) => {
            const job = a.job;
            const open = expanded === a.id;
            const generating = genId === a.id || a.status === 'generating';
            return (
              <div key={a.id}>
                <div className="flex items-center gap-3 px-5 py-3 hover:bg-raised transition-colors">
                  <input
                    type="checkbox"
                    checked={selected.has(a.id)}
                    onChange={() => toggleOne(a.id)}
                    disabled={bulkBusy}
                    title={a.job ? 'Select' : 'Select (job removed — can still delete)'}
                    className="w-4 h-4 rounded border-ink text-sky focus:ring-sky bg-raised shrink-0 disabled:opacity-30"
                  />
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
                    </p>
                    {/* All three signals: original job fit · AI company tier · tailored-résumé fit (ADR 0029). */}
                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                      {typeof job?.fit_score === 'number' && (
                        <ScoreChip label="Job fit" value={job.fit_score} title="Original fit of your base résumé to this job" />
                      )}
                      {job?.company_tier && <CompanyTierBadge tier={job.company_tier} note={job.company_tier_note} />}
                      <TailoredScoreChip
                        app={a}
                        original={job?.fit_score ?? null}
                        busy={scoringTailored === a.id}
                        onScore={() => scoreTailored(a.id)}
                      />
                    </div>
                  </div>
                  <button
                    onClick={() => generate(a)}
                    disabled={!!genId || bulkBusy || !job}
                    title="Generate a job-tailored résumé from your base résumé (truthful reframing)"
                    className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] font-medium text-violet-300 bg-violet-500/10 border border-violet-500/30 hover:bg-violet-500/20 disabled:opacity-40 rounded-md transition-all shrink-0"
                  >
                    <Sparkles size={12} /> {generating ? 'Generating…' : a.tailored_resume ? 'Regenerate' : 'Generate'}
                  </button>
                  {/* PDF — created automatically after generation; download straight from the
                      row so there's no need to expand and scroll. Shows a spinner while rendering. */}
                  {rendering === a.id ? (
                    <span className="flex items-center gap-1 text-[11px] text-violet-300 shrink-0" title="Creating PDF…">
                      <Loader2 size={12} className="animate-spin" /> <span className="hidden sm:inline">PDF…</span>
                    </span>
                  ) : a.pdf_path ? (
                    <button
                      onClick={() => downloadPdf(a.id)}
                      title="Download the tailored résumé PDF"
                      className="flex items-center gap-1.5 px-2 sm:px-2.5 py-1.5 text-[12px] font-medium text-emerald bg-emerald/10 border border-emerald/30 hover:bg-emerald/20 rounded-md transition-all shrink-0"
                    >
                      <Download size={13} /> <span className="hidden sm:inline">PDF</span>
                    </button>
                  ) : null}
                  {/* Cover letter — generate on demand, then download straight from the row (ADR 0035). */}
                  {genCoverId === a.id ? (
                    <span className="flex items-center gap-1 text-[11px] text-sky shrink-0" title="Writing cover letter…">
                      <Loader2 size={12} className="animate-spin" /> <span className="hidden sm:inline">Cover…</span>
                    </span>
                  ) : a.cover_letter_pdf_path ? (
                    <button
                      onClick={() => downloadCoverPdf(a.id)}
                      title="Download the cover letter PDF"
                      className="flex items-center gap-1.5 px-2 sm:px-2.5 py-1.5 text-[12px] font-medium text-sky bg-sky/10 border border-sky/30 hover:bg-sky/20 rounded-md transition-all shrink-0"
                    >
                      <FileText size={13} /> <span className="hidden sm:inline">Cover</span>
                    </button>
                  ) : a.job ? (
                    <button
                      onClick={() => generateCoverLetter(a)}
                      disabled={!!genCoverId}
                      title="Generate a cover letter for this job"
                      className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] font-medium text-slate-muted border border-ink hover:text-sky hover:border-sky/30 disabled:opacity-40 rounded-md transition-all shrink-0"
                    >
                      <FileText size={12} /> Cover letter
                    </button>
                  ) : null}
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
                    <a href={job.application_url || job.url || '#'} target="_blank" rel="noopener noreferrer" onClick={() => { pendingApply.current = a; }} title="Open posting (will ask if you applied)" className="text-slate-muted hover:text-sky shrink-0">
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
                    {/* Custom instructions — extra guidance for the AI on top of the job
                        description (e.g. a recruiter's ask). Persisted on the row; applied on
                        the next Generate. This is also the generate control on small screens. */}
                    <div className="mb-4">
                      <label className="block text-[12px] font-medium text-slate-text mb-1.5">
                        Custom instructions for the AI <span className="text-slate-muted font-normal">— optional</span>
                      </label>
                      <textarea
                        value={instructions}
                        onChange={(e) => setInstructions(e.target.value)}
                        placeholder="e.g. Emphasize my Angular experience over React. Lead with the payments platform. Foreground Docker and CI/CD."
                        rows={3}
                        className="w-full bg-raised border border-ink focus:border-sky/40 outline-none px-3 py-2 rounded-lg text-[12px] text-slate-text resize-y placeholder:text-slate-muted/60"
                      />
                      <div className="flex flex-wrap items-center gap-2 mt-2">
                        <button
                          onClick={() => generate(a)}
                          disabled={!!genId || bulkBusy || !job}
                          title="Generate the tailored résumé using the job description plus your instructions above"
                          className="inline-flex items-center gap-1.5 px-3 py-2 text-[12px] font-medium text-violet-300 bg-violet-500/10 border border-violet-500/30 hover:bg-violet-500/20 disabled:opacity-40 rounded-md transition-all"
                        >
                          <Sparkles size={13} /> {generating ? 'Generating…' : a.tailored_resume ? 'Regenerate with instructions' : 'Generate with instructions'}
                        </button>
                        <span className="text-[11px] text-slate-muted">
                          The AI already has the job description — these notes tell it what to emphasize. It stays truthful (no fabrication).
                        </span>
                      </div>
                    </div>

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

                    {/* Cover letter — independent of the tailored résumé; written from the
                        base résumé + this job, then downloaded as a PDF (ADR 0035). */}
                    {job && (
                      <div className="mt-5 pt-4 border-t border-ink-subtle flex flex-wrap items-center gap-3">
                        <span className="text-[12px] text-slate-muted">Cover letter:</span>
                        <button
                          onClick={() => generateCoverLetter(a)}
                          disabled={genCoverId === a.id}
                          title="Write a cover letter for this job from your base résumé, then download the PDF"
                          className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-sky bg-sky/10 border border-sky/30 hover:bg-sky/20 disabled:opacity-40 rounded-md transition-all"
                        >
                          {genCoverId === a.id ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />}
                          {genCoverId === a.id ? 'Writing…' : a.cover_letter_pdf_path ? 'Regenerate' : 'Generate cover letter'}
                        </button>
                        {a.cover_letter_pdf_path && (
                          <button
                            onClick={() => downloadCoverPdf(a.id)}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-emerald border border-emerald/30 bg-emerald/10 hover:bg-emerald/20 rounded-md transition-all"
                          >
                            <Download size={13} /> Download cover letter
                          </button>
                        )}
                        {a.cover_letter_error && !a.cover_letter_pdf_path && (
                          <span className="text-[11px] text-rose">{a.cover_letter_error}</span>
                        )}
                        <span className="text-[11px] text-slate-muted">One click writes the letter and downloads the PDF.</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        </>
        )}
        </>
      )}

      {view === 'list' && apps.length > 0 && (
        <p className="text-[11px] text-slate-muted mt-4">
          Generation reframes your real experience for each job (never fabricated). Keep your{' '}
          <button onClick={() => setView('base')} className="text-sky hover:underline">base résumé</button> current for the best results.
        </p>
      )}

      {/* The bulk-generate progress toast is rendered globally by ProgressProvider so it
          stays pinned across tab switches while generation runs. */}

      {/* "Did you apply?" — shown after returning from the external posting link (parity with Jobs). */}
      {applyDialog && (
        <div className="fixed bottom-5 right-5 z-50 bg-card border border-ink rounded-xl p-4 shadow-2xl w-80 animate-slide-up">
          <p className="text-[13px] font-semibold text-slate-text mb-0.5">Did you apply?</p>
          <p className="text-[12px] text-slate-muted mb-4 truncate">
            {applyDialog.job?.title ?? 'This job'}
            {applyDialog.job?.company ? ` · ${applyDialog.job.company}` : ''}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => { patch(applyDialog.id, { status: 'applied' }); setApplyDialog(null); }}
              className="flex-1 px-3 py-2 text-[12px] font-medium text-emerald bg-emerald/10 border border-emerald/30 rounded-lg hover:bg-emerald/20 transition-all"
            >
              Yes, I applied ✓
            </button>
            <button
              onClick={() => setApplyDialog(null)}
              className="px-4 py-2 text-[12px] text-slate-muted border border-ink rounded-lg hover:bg-raised transition-all"
            >
              No
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Color a 0–10 score: ≥7 strong (green), 5–6 moderate (amber), else weak (red). */
function scoreColor(v: number): string {
  return v >= 7
    ? 'bg-emerald/10 border-emerald/25 text-emerald'
    : v >= 5
      ? 'bg-amber-500/10 border-amber-500/25 text-amber-400'
      : 'bg-rose/10 border-rose/30 text-rose';
}

/** Small labelled score chip (e.g. the original job fit). */
function ScoreChip({ label, value, title }: { label: string; value: number; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded border ${scoreColor(value)}`}>
      {label} {value}/10
    </span>
  );
}

/**
 * The tailored-résumé fit chip (ADR 0029): shows the new score (with the delta vs the
 * original job fit) once computed; a spinner while scoring; or a one-click "Score
 * résumé" when a résumé exists but hasn't been scored (e.g. older applications).
 */
function TailoredScoreChip({
  app,
  original,
  busy,
  onScore,
}: {
  app: ApplicationWithJob;
  original: number | null;
  busy: boolean;
  onScore: () => void;
}) {
  if (busy) {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded border border-violet-500/25 bg-violet-500/10 text-violet-300">
        <Loader2 size={10} className="animate-spin" /> Scoring résumé…
      </span>
    );
  }
  if (typeof app.tailored_fit_score === 'number') {
    const v = app.tailored_fit_score;
    const delta = original != null ? v - original : null;
    return (
      <span
        title={app.tailored_score_note || 'Fit of your tailored résumé to this job'}
        className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded border ${scoreColor(v)}`}
      >
        <Sparkles size={10} /> Résumé {v}/10
        {delta != null && delta !== 0 ? <span className="opacity-70">({delta > 0 ? '+' : ''}{delta})</span> : null}
      </span>
    );
  }
  if (app.tailored_resume) {
    return (
      <button
        onClick={onScore}
        title="Score your tailored résumé against this job"
        className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded border border-ink text-slate-muted hover:text-violet-300 hover:border-violet-500/30 transition-all"
      >
        <Sparkles size={10} /> Score résumé
      </button>
    );
  }
  return null;
}
