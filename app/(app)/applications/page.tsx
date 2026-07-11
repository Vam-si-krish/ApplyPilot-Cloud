'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, Trash2, CheckCircle2, FileText, Briefcase, Clock, ChevronDown, ChevronRight, Sparkles, Save, AlertCircle, FileDown, Download, Loader2, Plus, Search, Gauge, FolderInput, FolderOutput } from 'lucide-react';
import BaseResumeEditor from '@/components/BaseResumeEditor';
import ManualGenerate from '@/components/ManualGenerate';
import ResumeFields from '@/components/ResumeFields';
import ResumeDiff from '@/components/ResumeDiff';
import ChangesReview, { confirmTailorChanges } from '@/components/ChangesReview';
import CompanyTierBadge from '@/components/CompanyTierBadge';
import { useProgress } from '@/components/ProgressContext';
import type { ApplicationWithJob, ApplicationStatus, ResumeDoc } from '@/lib/types';
import { scoreUsageCostUsd } from '@/lib/pricing';

type View = 'list' | 'parked' | 'base' | 'manual';

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

// Error text that means the Claude subscription window / provider quota is exhausted —
// every further generation would fail identically, so the bulk loop stops early instead
// of marching the rest of the batch into the same failure (ADR 0060).
const LIMIT_RE = /hit your[\s\S]{0,40}limit|usage limit|rate.?limit|quota|credit balance|out of (credits?|tokens?)/i;

export default function ApplicationsPage() {
  const [view, setView] = useState<View>('list');
  const [apps, setApps] = useState<ApplicationWithJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  // Mirrors `expanded` for async draft loads — a slow full-row fetch must not seed the
  // editor after the user has moved to another row (see toggleExpand).
  const expandedRef = useRef<string | null>(null);
  const [genId, setGenId] = useState<string | null>(null); // application currently generating
  const [genCoverId, setGenCoverId] = useState<string | null>(null); // application whose cover letter is generating
  const [atsId, setAtsId] = useState<string | null>(null); // application whose tailored ATS check is running
  const [msg, setMsg] = useState<string | null>(null);

  // Filters (parity with the Jobs tab — the subset that maps to applications).
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | ApplicationStatus>('all');
  const [hideApplied, setHideApplied] = useState(true);

  // Auto-download on open (ADR 0061): when on, opening a posting from a row also
  // downloads that job's tailored résumé PDF (+ cover letter) in the background.
  // Persisted per-browser, like the Jobs tab's collapsed-filters preference.
  const [autoDownload, setAutoDownload] = useState(false);
  useEffect(() => {
    setAutoDownload(localStorage.getItem('taAutoDownload') === '1');
  }, []);
  function toggleAutoDownload() {
    setAutoDownload((v) => {
      localStorage.setItem('taAutoDownload', v ? '0' : '1');
      return !v;
    });
  }

  // Local editable draft of the expanded application's tailored résumé.
  const [draft, setDraft] = useState<ResumeDoc | null>(null);
  // The base résumé (fetched once) — diff target for the "Review changes" view (ADR 0053).
  const [baseResume, setBaseResume] = useState<ResumeDoc | null>(null);
  // Expanded app view: edit the tailored résumé, or review the diff vs the base résumé.
  const [reviewMode, setReviewMode] = useState(false);
  // Custom tailoring instructions for the expanded app (ADR 0037) — extra guidance the
  // AI applies on top of the job description (e.g. a recruiter's ask). Seeded on expand.
  const [instructions, setInstructions] = useState('');
  const [savingDraft, setSavingDraft] = useState(false);
  const [rendering, setRendering] = useState<string | null>(null); // application currently rendering a PDF
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

  // Load the base résumé once — the diff target for "Review changes" (ADR 0053).
  useEffect(() => {
    fetch('/api/base-resume')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.base_resume && setBaseResume(d.base_resume as ResumeDoc))
      .catch(() => {});
  }, []);

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

  // Clear the selection whenever the filters or the tab change (the visible rows change).
  useEffect(() => {
    setSelected(new Set());
  }, [search, statusFilter, hideApplied, view]);

  function toggleExpand(a: ApplicationWithJob) {
    if (expanded === a.id) {
      expandedRef.current = null;
      setExpanded(null);
      setDraft(null);
      setInstructions('');
      setReviewMode(false);
    } else {
      expandedRef.current = a.id;
      setExpanded(a.id);
      setInstructions(a.tailor_instructions ?? '');
      setReviewMode(false);
      // The slim list omits the résumé document — fetch the full row for the editor.
      // The ref guards against a slow response landing after the user expanded another
      // row (or collapsed) in the meantime.
      setDraft(null);
      if (a.has_resume) {
        fetchApp(a.id)
          .then((row) => {
            if (expandedRef.current === a.id && row?.tailored_resume) {
              setDraft(structuredClone(row.tailored_resume));
            }
          })
          .catch(() => {});
      }
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

  // Record that the user opened this application's posting (ADR 0063), so the row can
  // flag "opened, but you haven't logged whether you applied". Stored as the JOB's
  // clicked_at (same field the Jobs tab uses — opening from either tab stays in sync).
  // Optimistic so the amber state shows the instant they return; skipped once set or
  // once applied (no point flagging follow-up on a done row).
  function markOpened(a: ApplicationWithJob) {
    const job = a.job;
    if (!job || job.clicked_at || a.applied_at) return;
    const now = new Date().toISOString();
    setApps((prev) => prev.map((x) => (x.id === a.id && x.job ? { ...x, job: { ...x.job, clicked_at: now } } : x)));
    fetch(`/api/jobs/${job.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clicked_at: now }),
    }).catch(() => {});
  }

  async function remove(id: string) {
    if (!confirm('Remove this application?')) return;
    await fetch(`/api/applications/${id}`, { method: 'DELETE' });
    if (expanded === id) {
      expandedRef.current = null;
      setExpanded(null);
    }
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
      if (expanded && ids.includes(expanded)) {
        expandedRef.current = null;
        setExpanded(null);
      }
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

  // Park/unpark the selected rows (ADR 0061): parked rows live in the Set Aside tab —
  // out of the working Queue and skipped by the overnight drain — with all state kept.
  async function setParkedSelected(parked: boolean) {
    const ids = [...selected];
    if (ids.length === 0 || bulkBusy) return;
    setBulkBusy(true);
    try {
      await Promise.all(
        ids.map((id) =>
          fetch(`/api/applications/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ parked }),
          }),
        ),
      );
      if (expanded && ids.includes(expanded)) {
        expandedRef.current = null;
        setExpanded(null);
      }
      setSelected(new Set());
      setMsg(parked ? `Set aside ${ids.length} — find them under the Set Aside tab.` : `Moved ${ids.length} back to the Queue.`);
      load(true);
    } catch {
      setMsg('Could not move the selected applications.');
    } finally {
      setBulkBusy(false);
      setTimeout(() => setMsg(null), 5000);
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

  // Fetch a single application's FULL row (including tailored_resume, which the slim
  // list omits). Used to poll for the worker's async tailoring result and to load the
  // editor on expand — polling the whole list here cost ~11 MB per tick at 650 rows.
  async function fetchApp(id: string): Promise<ApplicationWithJob | null> {
    const r = await fetch(`/api/applications/${id}`);
    if (!r.ok) return null;
    const d = await r.json().catch(() => ({}));
    return d.application ?? null;
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
        setMsg('Tailored résumé generated.');
        expandedRef.current = a.id;
        setExpanded(a.id);
        setDraft(row.tailored_resume ? structuredClone(row.tailored_resume) : null);
        // Tailored-résumé scoring removed (ADR 0050): the base fit_score already reflects a
        // tailoring-aware fit, so re-scoring the tailored résumé on the same rubric was
        // redundant. Auto-create the PDF so it's ready to download from the row.
        setRendering(a.id);
        setMsg('Tailored résumé ready — creating the PDF…');
        const pdf = await doRender(a.id);
        setRendering(null);
        setMsg(
          pdf.ok
            ? 'Résumé and PDF ready — download from the row, or review and edit below.'
            : `Résumé ready — PDF render failed: ${pdf.error}. Use “Create PDF” below to retry.`,
        );
        // Auto-run the local ATS re-check on the fresh tailored résumé (no AI, instant)
        // so the row's gauge shows how the tailoring scores against this job.
        atsCheck(row, true).catch(() => {});
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
  // Queue shows unparked rows; Set Aside shows parked ones (ADR 0061).
  const inParked = view === 'parked';
  const parkedCount = apps.filter((a) => a.parked).length;
  const q = search.trim().toLowerCase();
  const filtered = apps.filter((a) => {
    if (!!a.parked !== inParked) return false;
    if (statusFilter !== 'all' && a.status !== statusFilter) return false;
    if (hideApplied && statusFilter !== 'applied' && a.status === 'applied') return false;
    if (q) {
      const hay = `${a.job?.title ?? ''} ${a.job?.company ?? ''} ${a.job?.location ?? ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  // Any visible row can be selected (so job-removed clutter is bulk-deletable);
  // Generate only acts on the ones that still have a job AND no résumé yet — a bulk
  // pass never re-tailors finished rows (each redo costs a call, and a failing redo
  // used to clobber good rows; ADR 0060). Use a row's Regenerate button for a redo.
  const selectableIds = filtered.map((a) => a.id);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));
  const selectedGeneratable = [...selected].filter((id) => {
    const a = apps.find((x) => x.id === id);
    return a?.job && !a.has_resume;
  }).length;
  // Applications waiting to be tailored — what the overnight drain (and "Run queue now")
  // acts on. Set-aside rows are deliberately excluded (the drain skips them too).
  const queuedCount = apps.filter((a) => a.status === 'queued' && a.job && !a.has_resume && !a.parked).length;
  function toggleSelectAll() {
    setSelected(allSelected ? new Set() : new Set(selectableIds));
  }

  // Generate tailored résumés for every selected application, a few at a time
  // (GEN_CONCURRENCY) since each is an independent pipeline, driving one shared progress
  // bar. Per app, it mirrors the single-generate flow: hand off → poll the row until
  // ready/failed → score the new résumé → auto-create the PDF.
  async function generateSelected() {
    if (bulkBusy || bulkRunning || genId) return;
    const all = [...selected];
    // Only rows without a résumé — bulk generate never silently re-tailors finished
    // rows (ADR 0060); the per-row Regenerate button is the deliberate redo path.
    const ids = all.filter((id) => {
      const a = apps.find((x) => x.id === id);
      return a?.job && !a.has_resume;
    });
    if (ids.length === 0) return;
    const skipped = all.filter((id) => apps.find((x) => x.id === id)?.has_resume).length;
    setBulkBusy(true);
    setMsg(skipped > 0 ? `Skipped ${skipped} that already have a résumé — use a row's Regenerate to redo one.` : null);
    let done = 0;
    let ok = 0;
    let failed = 0;
    let limitHit = false; // set when a row fails with an out-of-quota error — stops the pool
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
            // Tailored-résumé scoring removed (ADR 0050) — tailor + render only.
            // Auto-create the PDF too, so every generated résumé is download-ready.
            await doRender(id).catch(() => {});
          } else {
            failed++;
            // Out of quota → every remaining row would fail the same way; trip the breaker.
            if (row?.status === 'failed' && LIMIT_RE.test(row.error ?? '')) limitHit = true;
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
      const queue = [...ids];
      // Cache warm-up: the FIRST generation runs alone so the stable prompt prefix
      // (system prompt + base résumé, ADR 0056/0064) gets written to the provider's
      // cache once — launching GEN_CONCURRENCY cold calls at t=0 made every one of
      // them a cache miss that paid full input price. The rest then read the warm
      // prefix at ~0.1× the input rate.
      if (queue.length > 1) {
        await processApp(queue.shift()!);
      }
      // Bounded-concurrency pool: up to GEN_CONCURRENCY pipelines in flight at once.
      const runWorker = async () => {
        for (let id = queue.shift(); id && !limitHit; id = queue.shift()) {
          await processApp(id);
        }
      };
      if (!limitHit && queue.length > 0) {
        await Promise.all(Array.from({ length: Math.min(GEN_CONCURRENCY, queue.length) }, runWorker));
      }

      const untouched = ids.length - done;
      setBulkProgress({
        label: limitHit
          ? `Stopped — Claude usage limit hit. ${ok} generated${untouched > 0 ? `; ${untouched} left queued for after the window resets` : ''}`
          : `Done — ${ok} generated${failed ? `, ${failed} failed` : ''}`,
        done,
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

  // Trigger a browser download for a signed storage URL. The URL is CROSS-ORIGIN
  // (Supabase Storage), for which browsers IGNORE the <a download> attribute and treat
  // the click as a top-level navigation — so firing two at once (résumé + cover letter)
  // makes the navigations race and cancel each other, landing only one file (ADR 0061
  // bug). Fetching the bytes into a same-origin blob URL sidesteps this: blob downloads
  // aren't navigations, so any number run concurrently and the filename is honoured.
  async function triggerDownload(url: string, filename?: string): Promise<void> {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`status ${res.status}`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = filename || '';
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoke after the browser has taken the blob (immediate revoke can abort it).
      setTimeout(() => URL.revokeObjectURL(objectUrl), 15000);
    } catch {
      // Fallback (e.g. blob fetch blocked): direct navigation still downloads via the
      // server's Content-Disposition, just can't be parallelised.
      const a = document.createElement('a');
      a.href = url;
      if (filename) a.download = filename;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
  }

  // Download the generated PDF with a proper filename (ADR 0030).
  async function downloadPdf(id: string): Promise<boolean> {
    try {
      const d = await fetch(`/api/applications/${id}/pdf`).then((r) => r.json());
      if (!d.url) {
        setMsg(d.error || 'No PDF available.');
        return false;
      }
      await triggerDownload(d.url, d.filename);
      return true;
    } catch {
      setMsg('Could not download the PDF.');
      return false;
    }
  }

  // Download the cover-letter PDF via a signed URL with a proper filename (ADR 0035).
  async function downloadCoverPdf(id: string): Promise<boolean> {
    try {
      const d = await fetch(`/api/applications/${id}/cover-letter/pdf`).then((r) => r.json());
      if (!d.url) {
        setMsg(d.error || 'No cover letter available.');
        return false;
      }
      await triggerDownload(d.url, d.filename);
      return true;
    } catch {
      setMsg('Could not download the cover letter.');
      return false;
    }
  }

  // Generate a cover letter for one application: hand off to the worker (async), poll
  // the row until the PDF lands (or it errors), then auto-download it (one-click flow).
  // Local ATS re-check of the TAILORED résumé vs the job (ADR 0053 addendum) — the
  // Jobscan loop: tailor → rescan → confirm the gaps closed. No AI call; instant.
  async function atsCheck(a: ApplicationWithJob, silent = false) {
    if (atsId || !a.has_resume) return;
    setAtsId(a.id);
    try {
      const r = await fetch('/api/applications/ats-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: a.id }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (!silent) setMsg(`ATS check failed: ${d.error || 'unknown error'}`);
        return;
      }
      if (!silent) {
        const from = d.base?.score;
        const missing = (d.tailored?.breakdown?.missing ?? []).slice(0, 4).join(', ');
        setMsg(
          `ATS match: ${typeof from === 'number' ? `${from}% → ` : ''}${d.tailored.score}% with the tailored résumé` +
            (missing ? ` · still missing: ${missing}` : ''),
        );
      }
      load(true);
    } catch {
      if (!silent) setMsg('ATS check failed.');
    } finally {
      setAtsId(null);
      if (!silent) setTimeout(() => setMsg(null), 8000);
    }
  }

  // Bulk ATS re-check: run the local base→tailored ATS match for every selected
  // application that has a résumé. Pure CPU on the server, no AI — parallel ×4.
  async function atsCheckSelected() {
    const targets = filtered.filter((a) => selected.has(a.id) && a.has_resume);
    if (targets.length === 0) {
      setMsg('None of the selected applications has a tailored résumé yet — generate first.');
      setTimeout(() => setMsg(null), 5000);
      return;
    }
    setBulkBusy(true);
    setMsg(`ATS-checking ${targets.length} résumé${targets.length === 1 ? '' : 's'}…`);
    let ok = 0;
    let failed = 0;
    const queue = [...targets];
    const worker = async () => {
      for (let a = queue.shift(); a; a = queue.shift()) {
        try {
          const r = await fetch('/api/applications/ats-check', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: a.id }),
          });
          if (r.ok) ok++;
          else failed++;
        } catch {
          failed++;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, targets.length) }, () => worker()));
    setMsg(`ATS checked ${ok} résumé${ok === 1 ? '' : 's'}${failed ? `, ${failed} failed` : ''}.`);
    await load(true);
    setBulkBusy(false);
    setTimeout(() => setMsg(null), 6000);
  }

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
    <div className="p-4 sm:p-6 lg:p-8 animate-slide-up">
      <div className="mb-6">
        <h1 className="page-title text-2xl">Tailor &amp; Apply</h1>
        <p className="page-sub">
          Tailor a résumé for each shortlisted job, generate the PDF, then apply. Add jobs from the{' '}
          <Link href="/jobs" className="text-sky hover:underline">Jobs</Link> tab.
        </p>
      </div>

      <div className="flex gap-1 mb-5 border-b border-ink">
        {([
          { id: 'list' as View, label: 'Queue' },
          { id: 'parked' as View, label: 'Set Aside' },
          { id: 'manual' as View, label: 'Quick Generate' },
          { id: 'base' as View, label: 'Base résumé' },
        ]).map((t) => (
          <button
            key={t.id}
            onClick={() => setView(t.id)}
            title={t.id === 'parked' ? 'Applications you moved out of the way (e.g. Easy Apply, or ones you couldn’t finish) — everything is kept; move them back anytime' : undefined}
            className={`relative px-4 py-2 text-[13px] font-medium -mb-px transition-all ${
              view === t.id ? 'text-sky' : 'text-slate-muted hover:text-slate-text'
            }`}
          >
            {t.label}
            {t.id === 'parked' && parkedCount > 0 && (
              <span className="ml-1.5 rounded-md bg-sky/15 px-1.5 py-px font-mono text-[10px] text-sky">{parkedCount}</span>
            )}
            {view === t.id && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-gradient-to-r from-sky to-iris" />}
          </button>
        ))}
      </div>

      {msg && (
        <div className="mb-3 rounded-lg border border-sky/20 bg-sky/5 px-3 py-2 text-[12px] text-slate-text animate-fade-in">
          {msg}
        </div>
      )}

      {view === 'list' && (
        <div className="mb-4">
          <button onClick={() => setShowCustom((v) => !v)} className="btn-ghost px-3 py-1.5 text-[12px]">
            <Plus size={14} /> Add custom job
          </button>

          {showCustom && (
            <div className="mt-3 card p-4 animate-fade-in">
              <p className="text-[12px] text-slate-muted mb-3">
                Add a job you found yourself (e.g. from an email). <span className="text-slate-text">Company</span> and{' '}
                <span className="text-slate-text">link</span> are optional; the description is what the résumé is tailored to.
              </p>
              <div className="grid sm:grid-cols-2 gap-3 mb-3">
                <input
                  value={customForm.title}
                  onChange={(e) => setCustomForm({ ...customForm, title: e.target.value })}
                  placeholder="Job title *"
                  className="px-3 py-2 text-[13px] bg-base/80 border border-ink rounded-lg text-slate-text placeholder:text-slate-dim focus:border-sky/50 focus:ring-1 focus:ring-sky/25 outline-none transition-colors"
                />
                <input
                  value={customForm.company}
                  onChange={(e) => setCustomForm({ ...customForm, company: e.target.value })}
                  placeholder="Company (optional)"
                  className="px-3 py-2 text-[13px] bg-base/80 border border-ink rounded-lg text-slate-text placeholder:text-slate-dim focus:border-sky/50 focus:ring-1 focus:ring-sky/25 outline-none transition-colors"
                />
              </div>
              <input
                value={customForm.url}
                onChange={(e) => setCustomForm({ ...customForm, url: e.target.value })}
                placeholder="Job / apply link (optional)"
                className="w-full px-3 py-2 text-[13px] bg-base/80 border border-ink rounded-lg text-slate-text placeholder:text-slate-dim focus:border-sky/50 focus:ring-1 focus:ring-sky/25 outline-none transition-colors mb-3"
              />
              <textarea
                value={customForm.description}
                onChange={(e) => setCustomForm({ ...customForm, description: e.target.value })}
                placeholder="Paste the full job description *"
                rows={6}
                className="w-full px-3 py-2 text-[13px] bg-base/80 border border-ink rounded-lg text-slate-text placeholder:text-slate-dim focus:border-sky/50 focus:ring-1 focus:ring-sky/25 outline-none transition-colors mb-3 resize-y"
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
        <div className="card divide-y divide-ink-subtle overflow-hidden">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-5 py-4 animate-pulse" style={{ opacity: 1 - i * 0.18 }}>
              <div className="h-4 w-4 rounded bg-raised" />
              <div className="h-5 w-16 rounded-md bg-raised" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-1/3 rounded bg-raised" />
                <div className="h-2.5 w-1/4 rounded bg-raised/70" />
              </div>
            </div>
          ))}
        </div>
      ) : apps.length === 0 ? (
        <div className="card px-6 py-16 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-ink bg-raised/60">
            <FileText size={20} className="text-slate-dim" />
          </div>
          <h3 className="text-[14px] font-medium text-slate-text mb-1">Nothing queued yet</h3>
          <p className="text-[13px] text-slate-muted max-w-md mx-auto mb-5">
            On the Jobs tab, select the roles you want to apply to and use <span className="text-sky">Send to Tailor &amp; Apply</span>
            {' '}— or use <span className="text-sky">Add custom job</span> above to enter one yourself (e.g. from an email).
            They&apos;ll appear here, ready for a tailored résumé.
          </p>
          <Link href="/jobs" className="btn-primary">
            <Briefcase size={14} /> Go to Jobs
          </Link>
        </div>
      ) : (
        <>
        {/* Filters — search, status, hide applied (the Jobs-tab subset that maps here) */}
        <div className="space-y-3 mb-4">
          <div className="relative max-w-md">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-dim" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search title, company, location…"
              className="pl-9 pr-3 py-1.5 w-full bg-card border border-ink rounded-lg text-[13px] text-slate-text placeholder:text-slate-dim focus:border-sky/50 focus:ring-1 focus:ring-sky/25 outline-none transition-colors"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex flex-wrap gap-0.5 rounded-xl border border-ink bg-card/70 p-1">
              {STATUS_FILTERS.map((st) => (
                <button
                  key={st}
                  onClick={() => setStatusFilter(st)}
                  className={`px-3 py-1.5 text-[12px] rounded-lg capitalize transition-all ${
                    statusFilter === st
                      ? st === 'applied'
                        ? 'bg-emerald/15 text-emerald shadow-[inset_0_0_0_1px_rgba(52,211,153,0.3)]'
                        : 'bg-sky/15 text-sky shadow-[inset_0_0_0_1px_rgba(56,189,248,0.3)]'
                      : 'text-slate-muted hover:text-slate-text hover:bg-raised/80'
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>
            <span className="hidden sm:block w-px h-5 bg-ink mx-1" />
            <label
              title="Hide applications you've already applied to"
              className={`flex items-center gap-1.5 px-3 py-1.5 text-[12px] rounded-lg border cursor-pointer select-none transition-all ${
                hideApplied && statusFilter !== 'applied' ? 'bg-sky-glow text-sky border-sky/30' : 'text-slate-muted border-ink hover:text-slate-text hover:bg-raised'
              } ${statusFilter === 'applied' ? 'opacity-40 pointer-events-none' : ''}`}
            >
              <input
                type="checkbox"
                checked={hideApplied && statusFilter !== 'applied'}
                onChange={(e) => setHideApplied(e.target.checked)}
                className="w-3.5 h-3.5 rounded accent-sky"
              />
              Hide applied
            </label>
            {/* Auto-download on open (ADR 0061) */}
            <label
              title="When you open a posting from a row here, its tailored résumé PDF (and cover letter, if generated) download automatically. Tip: Ctrl/Cmd-click the open-link on several rows to open them all in background tabs — each job's PDFs download as you go."
              className={`flex items-center gap-1.5 px-3 py-1.5 text-[12px] rounded-lg border cursor-pointer select-none transition-all ${
                autoDownload ? 'bg-emerald/10 text-emerald border-emerald/30' : 'text-slate-muted border-ink hover:text-slate-text hover:bg-raised'
              }`}
            >
              <input
                type="checkbox"
                checked={autoDownload}
                onChange={toggleAutoDownload}
                className="w-3.5 h-3.5 rounded accent-sky"
              />
              <Download size={12} /> Auto-download on open
            </label>
          </div>
          {autoDownload && (
            <p className="text-[11px] text-slate-muted animate-fade-in">
              Opening a posting now also downloads its résumé (+ cover letter) PDF.{' '}
              <span className="text-slate-text">Tip:</span> Ctrl/Cmd-click the{' '}
              <ExternalLink size={10} className="inline -mt-0.5" /> link on several rows to open them all in background
              tabs — the PDFs download as you go. If the browser asks, allow “multiple downloads”.
            </p>
          )}
        </div>

        {filtered.length === 0 ? (
          <div className="card px-6 py-12 text-center">
            {inParked ? <FolderInput size={20} className="mx-auto text-slate-dim mb-2" /> : <FileText size={20} className="mx-auto text-slate-dim mb-2" />}
            {inParked && parkedCount === 0 ? (
              <>
                <p className="text-[13px] text-slate-text mb-1">Nothing set aside yet.</p>
                <p className="text-[12px] text-slate-muted max-w-md mx-auto">
                  Use the <FolderInput size={11} className="inline -mt-0.5" /> button on a Queue row (or select several and
                  hit <span className="text-slate-text">Set aside</span>) to park applications here — e.g. Easy Apply ones,
                  or ones you couldn&apos;t finish — without losing their résumé or PDF.
                </p>
              </>
            ) : (
              <>
                <p className="text-[13px] text-slate-text mb-1">No applications match these filters.</p>
                <button
                  onClick={() => { setSearch(''); setStatusFilter('all'); setHideApplied(false); }}
                  className="text-[12px] text-sky hover:underline"
                >
                  Clear filters
                </button>
              </>
            )}
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
              className="w-4 h-4 rounded accent-sky"
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
            title="Generate a tailored résumé for every selected application that doesn't have one yet (rows with a résumé are skipped — use a row's Regenerate to redo one)"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-violet-300 bg-violet-500/10 border border-violet-500/30 hover:bg-violet-500/20 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg transition-all"
          >
            {bulkBusy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
            {bulkBusy ? 'Generating…' : `Generate selected${selectedGeneratable > 0 ? ` (${selectedGeneratable})` : ''}`}
          </button>
          <button
            onClick={atsCheckSelected}
            disabled={bulkBusy || bulkRunning || !!genId || selected.size === 0}
            title="Re-run the local ATS match (base → tailored) for every selected application that already has a tailored résumé. No AI, instant."
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-slate-text bg-card border border-ink hover:bg-raised disabled:opacity-40 disabled:cursor-not-allowed rounded-lg transition-all"
          >
            <Gauge size={13} /> ATS check selected
          </button>
          <button
            onClick={() => setParkedSelected(!inParked)}
            disabled={bulkBusy || selected.size === 0}
            title={
              inParked
                ? 'Move the selected applications back to the working Queue'
                : 'Move the selected applications to the Set Aside tab (e.g. Easy Apply, or ones you couldn’t finish) — everything is kept, they just stop taking up space here'
            }
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-slate-text bg-card border border-ink hover:bg-raised disabled:opacity-40 disabled:cursor-not-allowed rounded-lg transition-all"
          >
            {inParked ? <FolderOutput size={13} /> : <FolderInput size={13} />}
            {inParked ? 'Move to Queue' : 'Set aside'}
            {selected.size > 0 ? ` (${selected.size})` : ''}
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
        <div className="card overflow-hidden divide-y divide-ink-subtle">
          {filtered.map((a) => {
            const job = a.job;
            const open = expanded === a.id;
            const generating = genId === a.id || a.status === 'generating';
            // Opened the posting but never logged an apply (ADR 0063) — needs follow-up.
            const openedNotLogged = !!job?.clicked_at && !a.applied_at && a.status !== 'applied';
            return (
              <div key={a.id}>
                <div
                  className={`flex items-center gap-3 border-l-2 px-5 py-3 transition-colors ${
                    openedNotLogged
                      ? 'border-amber-400/70 bg-amber-400/[0.05] hover:bg-amber-400/[0.08]'
                      : 'border-transparent hover:bg-raised/60'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(a.id)}
                    onChange={() => toggleOne(a.id)}
                    disabled={bulkBusy}
                    title={a.job ? 'Select' : 'Select (job removed — can still delete)'}
                    className="w-4 h-4 rounded accent-sky shrink-0 disabled:opacity-30"
                  />
                  <button
                    onClick={() => toggleExpand(a)}
                    className={`p-1 rounded-md shrink-0 transition-colors ${open ? 'text-sky bg-sky/10' : 'text-slate-muted hover:text-sky hover:bg-sky/10'}`}
                  >
                    {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                  </button>
                  <span className={`shrink-0 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider rounded-md border ${STATUS_STYLE[a.status]}`}>
                    {a.status}
                  </span>
                  {/* Opened-but-not-logged flag (ADR 0063): you viewed the posting but
                      never recorded whether you applied. Clears on "Mark applied". */}
                  {openedNotLogged && (
                    <span
                      title="You opened this posting but haven't logged whether you applied. Mark it applied (✓) once you have, or set it aside if you're skipping it."
                      className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider rounded-md border border-amber-400/40 bg-amber-400/10 text-amber-400"
                    >
                      <ExternalLink size={10} /> Opened
                    </span>
                  )}
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
                    </div>
                  </div>
                  <button
                    onClick={() => generate(a)}
                    disabled={!!genId || bulkBusy || !job}
                    title="Generate a job-tailored résumé from your base résumé (truthful reframing)"
                    className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] font-medium text-violet-300 bg-violet-500/10 border border-violet-500/30 hover:bg-violet-500/20 disabled:opacity-40 rounded-lg transition-all shrink-0"
                  >
                    <Sparkles size={12} /> {generating ? 'Generating…' : a.has_resume ? 'Regenerate' : 'Generate'}
                  </button>
                  {/* Local ATS check of the TAILORED résumé vs this job (ADR 0053 addendum).
                      Auto-runs after generation; click to re-check (e.g. after edits). */}
                  {a.has_resume &&
                    (atsId === a.id ? (
                      <span className="flex items-center gap-1 text-[11px] text-slate-muted shrink-0" title="Checking ATS match…">
                        <Loader2 size={12} className="animate-spin" /> <span className="hidden sm:inline">ATS…</span>
                      </span>
                    ) : (
                      <button
                        onClick={() => atsCheck(a)}
                        disabled={!!atsId}
                        title={
                          'ATS match: base résumé → tailored résumé against this job (local, no AI) — click to re-check' +
                          ((a.tailored_match_breakdown?.missing ?? []).length
                            ? `. Still missing: ${a.tailored_match_breakdown!.missing.slice(0, 6).join(', ')}`
                            : '') +
                          ((a.tailored_match_breakdown?.flags ?? []).length
                            ? `. ⚠ ${a.tailored_match_breakdown!.flags.join('; ')}`
                            : '')
                        }
                        className={`flex items-center gap-1 px-2 sm:px-2.5 py-1.5 text-[12px] font-medium rounded-lg border transition-all shrink-0 disabled:opacity-40 ${
                          a.tailored_match_score == null
                            ? 'text-slate-muted bg-raised border-ink hover:text-slate-text'
                            : a.tailored_match_score >= 65
                              ? 'text-emerald bg-emerald/10 border-emerald/30 hover:bg-emerald/20'
                              : a.tailored_match_score >= 40
                                ? 'text-amber-400 bg-amber-500/10 border-amber-500/30 hover:bg-amber-500/20'
                                : 'text-slate-muted bg-raised border-ink hover:text-slate-text'
                        }`}
                      >
                        <Gauge size={13} />
                        {a.tailored_match_score != null ? (
                          <>
                            {a.base_match_score != null && a.base_match_score !== a.tailored_match_score && (
                              <span className="opacity-60">{a.base_match_score}%→</span>
                            )}
                            {a.tailored_match_score}%
                          </>
                        ) : (
                          <span className="hidden sm:inline">ATS</span>
                        )}
                      </button>
                    ))}
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
                      className="flex items-center gap-1.5 px-2 sm:px-2.5 py-1.5 text-[12px] font-medium text-emerald bg-emerald/10 border border-emerald/30 hover:bg-emerald/20 rounded-lg transition-all shrink-0"
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
                      className="flex items-center gap-1.5 px-2 sm:px-2.5 py-1.5 text-[12px] font-medium text-sky bg-sky/10 border border-sky/30 hover:bg-sky/20 rounded-lg transition-all shrink-0"
                    >
                      <FileText size={13} /> <span className="hidden sm:inline">Cover</span>
                    </button>
                  ) : a.job ? (
                    <button
                      onClick={() => generateCoverLetter(a)}
                      disabled={!!genCoverId}
                      title="Generate a cover letter for this job"
                      className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] font-medium text-slate-muted border border-ink hover:text-sky hover:border-sky/30 disabled:opacity-40 rounded-lg transition-all shrink-0"
                    >
                      <FileText size={12} /> Cover letter
                    </button>
                  ) : null}
                  <span className="hidden md:flex items-center gap-1 text-slate-muted text-[11px] shrink-0">
                    <Clock size={11} /> {new Date(a.created_at).toLocaleDateString()}
                  </span>
                  {/* Applied toggle — also syncs the Jobs-tab row (server-side). */}
                  <button
                    onClick={() =>
                      a.applied_at
                        ? window.confirm('Un-mark this application as applied?') && patch(a.id, { applied_at: null })
                        : patch(a.id, { status: 'applied' })
                    }
                    title={a.applied_at ? `Applied ${new Date(a.applied_at).toLocaleDateString()} — click to un-mark` : 'Mark as applied'}
                    className={`p-1 rounded-md shrink-0 transition-colors ${a.applied_at ? 'text-emerald bg-emerald/10' : 'text-slate-muted hover:text-emerald hover:bg-emerald/10'}`}
                  >
                    <CheckCircle2 size={15} />
                  </button>
                  {/* Set Aside / bring back (ADR 0061) — everything is kept, just out of the way. */}
                  <button
                    onClick={() => patch(a.id, { parked: !a.parked })}
                    title={a.parked ? 'Move back to the Queue tab' : 'Set aside — move to the Set Aside tab (keeps the résumé/PDF/status; just out of the way)'}
                    className="p-1 rounded-md text-slate-muted hover:text-sky hover:bg-sky/10 transition-colors shrink-0"
                  >
                    {a.parked ? <FolderOutput size={15} /> : <FolderInput size={15} />}
                  </button>
                  {job && (
                    <a
                      href={job.application_url || job.url || '#'}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => {
                        pendingApply.current = a;
                        markOpened(a); // flag the row "opened, not yet logged" (ADR 0063)
                        // Auto-download on open (ADR 0061): grab this job's PDFs while the
                        // posting opens — works for Ctrl/Cmd-click background tabs too.
                        // Sequential (await) so the résumé finishes before the cover letter
                        // starts — concurrent starts intermittently dropped one (ADR 0062).
                        if (autoDownload) {
                          void (async () => {
                            if (a.pdf_path) await downloadPdf(a.id);
                            if (a.cover_letter_pdf_path) await downloadCoverPdf(a.id);
                          })();
                        }
                      }}
                      title={`Open posting (will ask if you applied)${autoDownload && a.pdf_path ? ' — auto-downloads the résumé PDF' : ''}`}
                      className="p-1 rounded-md text-slate-muted hover:text-sky hover:bg-sky/10 transition-colors shrink-0"
                    >
                      <ExternalLink size={15} />
                    </a>
                  )}
                  <button onClick={() => remove(a.id)} title="Remove application" className="p-1 rounded-md text-slate-muted hover:text-rose hover:bg-rose/10 transition-colors shrink-0">
                    <Trash2 size={15} />
                  </button>
                </div>

                {open && (
                  <div className="mx-4 sm:mx-5 mb-4 mt-1 rounded-xl border border-ink-subtle bg-base/60 px-5 py-4 animate-fade-in">
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
                          className="inline-flex items-center gap-1.5 px-3 py-2 text-[12px] font-medium text-violet-300 bg-violet-500/10 border border-violet-500/30 hover:bg-violet-500/20 disabled:opacity-40 rounded-lg transition-all"
                        >
                          <Sparkles size={13} /> {generating ? 'Generating…' : a.has_resume ? 'Regenerate with instructions' : 'Generate with instructions'}
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
                        <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
                          <p className="text-[12px] text-slate-muted">
                            {reviewMode
                              ? 'Reviewing what tailoring changed vs your base résumé.'
                              : 'Tailored résumé — edit freely, then create the PDF.'}
                          </p>
                          {/* Edit ⇄ Review-changes toggle (ADR 0053). */}
                          <div className="flex items-center gap-0.5 bg-raised border border-ink rounded-lg p-0.5 shrink-0">
                            <button
                              onClick={() => setReviewMode(false)}
                              className={`px-2.5 py-1 text-[12px] rounded-lg transition-colors ${!reviewMode ? 'bg-sky/15 text-sky' : 'text-slate-muted hover:text-slate-text'}`}
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => setReviewMode(true)}
                              title={baseResume ? 'Highlight what the AI added/removed vs your base résumé' : 'Set a base résumé first to see the diff'}
                              disabled={!baseResume}
                              className={`px-2.5 py-1 text-[12px] rounded-lg transition-colors disabled:opacity-40 ${reviewMode ? 'bg-emerald/15 text-emerald' : 'text-slate-muted hover:text-slate-text'}`}
                            >
                              Review changes
                            </button>
                          </div>
                        </div>
                        {reviewMode ? (
                          <ResumeDiff base={baseResume} tailored={draft} />
                        ) : (
                          <ResumeFields value={draft} onChange={setDraft} />
                        )}
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
                            className="px-2.5 py-1.5 bg-card border border-ink rounded-lg text-[12px] text-slate-text outline-none focus:border-sky/40"
                          >
                            <option value="classic">Classic (serif)</option>
                            <option value="modern">Modern (sans)</option>
                          </select>
                          <button
                            onClick={() => renderPdf(a)}
                            disabled={rendering === a.id}
                            title="Render the tailored résumé to a one-page PDF (saves the latest edits first is recommended)"
                            className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-violet-300 bg-violet-500/10 border border-violet-500/30 hover:bg-violet-500/20 disabled:opacity-40 rounded-lg transition-all"
                          >
                            <FileDown size={13} /> {rendering === a.id ? 'Rendering…' : a.pdf_path ? 'Re-render PDF' : 'Create PDF'}
                          </button>
                          {a.pdf_path && (
                            <button
                              onClick={() => downloadPdf(a.id)}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-emerald border border-emerald/30 bg-emerald/10 hover:bg-emerald/20 rounded-lg transition-all"
                            >
                              <Download size={13} /> Download PDF
                            </button>
                          )}
                          <span className="text-[11px] text-slate-muted">Re-render after edits to refresh the PDF.</span>
                        </div>

                        {/* What this generation cost (ADR 0064) — tokens against the
                            subscription window; cache_read > 0 means the prompt cache worked. */}
                        {a.tailor_usage && (
                          <p
                            className="mt-2 text-[11px] text-slate-dim font-mono"
                            title="Token usage of the last Generate call. 'cached' tokens are prompt tokens served from the cache (~10× cheaper against your usage window); 0 cached means the cache missed."
                          >
                            Generation: {fmtTokens(a.tailor_usage.input_tokens)} in
                            {a.tailor_usage.cache_read_input_tokens > 0 ? ` (+${fmtTokens(a.tailor_usage.cache_read_input_tokens)} cached)` : ' (0 cached)'}
                            {' · '}{fmtTokens(a.tailor_usage.output_tokens)} out
                            {(() => {
                              // Derived API-equivalent cost (ADR 0068) — the subscription SDKs
                              // (Claude Agent SDK, Codex) report tokens but no invoice figure.
                              const cost = scoreUsageCostUsd(a.tailor_usage);
                              return cost != null ? ` · $${cost.toFixed(3)}` : '';
                            })()}
                            {a.tailor_usage.ms ? ` · ${Math.round(a.tailor_usage.ms / 1000)}s` : ''}
                            {a.tailor_usage.model ? ` · ${a.tailor_usage.model}` : ''}
                          </p>
                        )}
                      </>
                    ) : a.has_resume ? (
                      // The slim list omits the document — it's being fetched for the editor.
                      <p className="flex items-center gap-2 text-[12px] text-slate-muted py-2">
                        <Loader2 size={13} className="animate-spin" /> Loading tailored résumé…
                      </p>
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
                          className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-sky bg-sky/10 border border-sky/30 hover:bg-sky/20 disabled:opacity-40 rounded-lg transition-all"
                        >
                          {genCoverId === a.id ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />}
                          {genCoverId === a.id ? 'Writing…' : a.cover_letter_pdf_path ? 'Regenerate' : 'Generate cover letter'}
                        </button>
                        {a.cover_letter_pdf_path && (
                          <button
                            onClick={() => downloadCoverPdf(a.id)}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-emerald border border-emerald/30 bg-emerald/10 hover:bg-emerald/20 rounded-lg transition-all"
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
        <div className="fixed bottom-5 right-5 z-50 card shadow-pop p-4 w-80 animate-slide-up">
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

/** "5.6k" style token count for the generation-usage line (ADR 0064). */
function fmtTokens(n: number | null | undefined): string {
  if (n == null) return '?';
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
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
    <span title={title} className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded-md border ${scoreColor(value)}`}>
      {label} {value}/10
    </span>
  );
}

