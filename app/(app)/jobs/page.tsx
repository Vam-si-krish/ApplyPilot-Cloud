'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Star, ExternalLink, ChevronDown, ChevronRight, Archive, Search, CheckCircle2, Sparkles, Trash2, Building2, History, FileText, SlidersHorizontal, AlertTriangle } from 'lucide-react';
import ScoreBadge from '@/components/ScoreBadge';
import JobDetails from '@/components/JobDetails';
import CompanyTierBadge from '@/components/CompanyTierBadge';
import SkillMatchBadge from '@/components/SkillMatchBadge';
import JobsLegend from '@/components/JobsLegend';
import ScoringPanel from '@/components/ScoringPanel';
import { useProgress } from '@/components/ProgressContext';
import type { Job } from '@/lib/types';

const STATUSES = ['all', 'scored', 'unscored', 'filtered', 'opened', 'shortlisted', 'applied', 'archived'] as const;
type StatusFilter = (typeof STATUSES)[number];

const STATUS_HELP: Record<StatusFilter, string> = {
  all: 'All jobs from the last 24h',
  scored: 'Jobs the AI has scored for fit',
  unscored: 'Not scored by the AI yet',
  filtered: 'Pre-screened out before AI scoring (low résumé keyword match)',
  opened: "You clicked the apply link but haven't marked it applied",
  shortlisted: 'Jobs you starred',
  applied: 'Jobs you marked as applied',
  archived: 'Hidden / skipped jobs',
};

const COMPANY_LABEL: Record<string, string> = {
  'good,medium': 'Good or Medium',
  good: 'Good',
  medium: 'Medium',
  low: 'Low',
  unknown: 'Unknown',
  none: 'Not assessed',
};

const EMPLOYMENT_LABEL: Record<string, string> = {
  full_time: 'Full-time',
  contract: 'Contract',
  internship: 'Internship',
};

interface RunSummary {
  id: string;
  started_at: string;
  jobs_found: number;
  jobs_scored: number;
  status: string;
}

function formatRunLabel(run: RunSummary): string {
  const date = new Date(run.started_at);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const isToday = date.toDateString() === today.toDateString();
  const isYesterday = date.toDateString() === yesterday.toDateString();
  const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const day = isToday ? 'Today' : isYesterday ? 'Yesterday' : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const status = run.status === 'running' ? ' · running…' : '';
  return `${day} ${time} · ${run.jobs_found} jobs${status}`;
}

export default function JobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  // Defaults to the "recommended" view (ADR 0010): strong jobs (6+) at solid
  // companies (good/medium). Change the filters to widen.
  const [minScore, setMinScore] = useState('6');
  const [maxScore, setMaxScore] = useState(''); // upper fit-score bound — lets you isolate low-fit jobs
  const [expanded, setExpanded] = useState<string | null>(null);
  const [easyApply, setEasyApply] = useState<boolean | null>(null);
  const [companyTier, setCompanyTier] = useState('good,medium');
  const [minSkill, setMinSkill] = useState(''); // skill-match % gate for the view
  const [employmentType, setEmploymentType] = useState(''); // full_time | contract | internship
  const [limit, setLimit] = useState(300); // page size; "Load more" raises it
  const [hideApplied, setHideApplied] = useState(true); // keep applied jobs out of the working list
  const [hideOpened, setHideOpened] = useState(false); // optionally hide ones you've opened but passed on
  const [hideInApplications, setHideInApplications] = useState(true); // jobs already queued for tailoring live under Tailor & Apply
  const [showMoreFilters, setShowMoreFilters] = useState(false); // collapsible secondary refinements (declutters the bar)
  const [allowRescore, setAllowRescore] = useState(false); // Settings gate (ADR 0039): when on, "Score selected" re-scores already-scored jobs

  // Run selector
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [selectedRunIds, setSelectedRunIds] = useState<string[]>([]);
  const [showRunsDropdown, setShowRunsDropdown] = useState(false);
  const runsDropdownRef = useRef<HTMLDivElement>(null);

  // Count of jobs still waiting to score (drives nothing visible now — the
  // ScoringPanel shows live progress + start/stop; kept for stats refreshes).
  const [unscoredCount, setUnscoredCount] = useState(0);
  void unscoredCount;

  // Bulk selection: pick specific jobs and score/archive just those.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);
  // Prominent, always-visible progress for the selection-based AI jobs (scoring /
  // company assessment) — lives in a shared provider so the toast stays pinned and
  // live even when you switch tabs mid-run (the work keeps running regardless).
  const { setProgress: setBulkProgress, running: bulkRunning } = useProgress();
  const [fetching, setFetching] = useState(false); // empty-state "Run a fetch" trigger

  // Apply tracking: when user clicks an external link we wait for them to return.
  const pendingApplyJob = useRef<Job | null>(null);
  const [applyDialog, setApplyDialog] = useState<Job | null>(null);

  // Fetch the runs list once on mount, and default the selector to the most recent
  // run *if* it happened within the last 24h — so the page opens on the latest fetch
  // instead of "All runs". An older latest run leaves it on "All runs". (The dropdown
  // itself is unchanged; this only sets the initial selection.)
  useEffect(() => {
    fetch('/api/runs')
      .then((r) => (r.ok ? r.json() : { runs: [] }))
      .then((d) => {
        const list: RunSummary[] = d.runs ?? [];
        setRuns(list);
        if (list.length > 0) {
          const latest = list.reduce((a, b) => (new Date(a.started_at) >= new Date(b.started_at) ? a : b));
          const ageMs = Date.now() - new Date(latest.started_at).getTime();
          if (ageMs <= 24 * 60 * 60 * 1000) setSelectedRunIds([latest.id]);
        }
      })
      .catch(() => {});
  }, []);

  const refreshStats = useCallback(async () => {
    try {
      const d = await fetch('/api/stats').then((r) => r.json());
      setUnscoredCount(d.unscored ?? 0);
    } catch {
      /* keep last value */
    }
  }, []);
  useEffect(() => {
    refreshStats();
  }, [refreshStats]);

  // Remember whether the secondary "More filters" panel is expanded (default collapsed).
  useEffect(() => {
    setShowMoreFilters(localStorage.getItem('jobsMoreFilters') === '1');
  }, []);
  function toggleMoreFilters() {
    setShowMoreFilters((v) => {
      localStorage.setItem('jobsMoreFilters', v ? '0' : '1');
      return !v;
    });
  }
  // How many of the *secondary* refinements are currently constraining the list — shown
  // as a badge on the toggle so a collapsed panel never hides an active filter silently.
  const moreFilterCount =
    (easyApply !== null ? 1 : 0) +
    (minSkill ? 1 : 0) +
    (employmentType ? 1 : 0) +
    (hideApplied && status !== 'applied' ? 1 : 0) +
    (hideOpened && status !== 'opened' ? 1 : 0) +
    (hideInApplications ? 1 : 0);

  // Reflect the re-scoring safety gate (ADR 0039): when it's on, "Score selected"
  // overwrites existing scores — surface that so it's deliberate, and so the user
  // remembers to switch it back off. Re-read on mount (Settings → Jobs remounts this).
  useEffect(() => {
    fetch('/api/settings')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setAllowRescore(!!d.allow_rescore))
      .catch(() => {});
  }, []);

  // Shared filter params (everything except pagination), reused by the list load
  // and by "select all matching" (idsOnly).
  // Unscored/Filtered jobs have no fit_score and no company tier, so those filters
  // would silently empty the list on those tabs — skip them there.
  const scoreless = status === 'unscored' || status === 'filtered';

  // Fit-score range setters that keep the range valid. Picking a max below the current
  // min (e.g. the default ≥6) clears the min — that's exactly the "show me the low-fit
  // jobs to delete" path — and vice-versa.
  function changeMinScore(v: string) {
    setMinScore(v);
    if (v && maxScore && Number(v) > Number(maxScore)) setMaxScore('');
  }
  function changeMaxScore(v: string) {
    setMaxScore(v);
    if (v && minScore && Number(minScore) > Number(v)) setMinScore('');
  }

  const buildParams = useCallback(() => {
    const p = new URLSearchParams();
    if (search) p.set('search', search);
    if (minScore && !scoreless) p.set('minScore', minScore);
    if (maxScore && !scoreless) p.set('maxScore', maxScore);
    if (minSkill === '0') p.set('maxSkill', '0'); // "No skill match" = matched none of my skills
    else if (minSkill) p.set('minSkill', minSkill);
    if (status === 'applied') p.set('applied', 'true');
    else if (status === 'shortlisted') p.set('shortlisted', 'true');
    else if (status === 'opened') p.set('opened', 'true');
    else if (status !== 'all') p.set('status', status);
    if (easyApply === true) p.set('easyApply', 'true');
    if (easyApply === false) p.set('easyApply', 'false');
    if (companyTier && !scoreless) p.set('companyTier', companyTier);
    if (employmentType) p.set('employmentType', employmentType);
    if (hideApplied && status !== 'applied') p.set('excludeApplied', 'true');
    if (hideOpened && status !== 'opened') p.set('excludeOpened', 'true');
    if (hideInApplications) p.set('excludeInApplications', 'true');
    if (selectedRunIds.length > 0) p.set('runId', selectedRunIds.join(','));
    p.set('recency', 'recent'); // main page = jobs discovered in the last 24h
    return p;
  }, [search, minScore, maxScore, minSkill, employmentType, scoreless, status, easyApply, companyTier, hideApplied, hideOpened, hideInApplications, selectedRunIds]);

  const load = useCallback(async () => {
    setLoading(true);
    const p = buildParams();
    p.set('limit', String(limit));
    const d = await fetch(`/api/jobs?${p.toString()}`).then((r) => r.json());
    setJobs(d.jobs ?? []);
    setTotal(d.total ?? 0);
    setLoading(false);
  }, [buildParams, limit]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  // Drop the selection whenever the filter set changes (the ids on screen change).
  useEffect(() => {
    setSelected(new Set());
  }, [search, status, minScore, maxScore, minSkill, employmentType, easyApply, companyTier, selectedRunIds]);

  // Reset pagination when filters change.
  useEffect(() => {
    setLimit(300);
  }, [search, status, minScore, maxScore, minSkill, employmentType, easyApply, companyTier, selectedRunIds]);

  // Close the runs dropdown on any click outside it (or Escape).
  useEffect(() => {
    if (!showRunsDropdown) return;
    function onDown(e: MouseEvent) {
      if (runsDropdownRef.current && !runsDropdownRef.current.contains(e.target as Node)) setShowRunsDropdown(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setShowRunsDropdown(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [showRunsDropdown]);

  // Detect when user returns to the tab after clicking an external job link.
  useEffect(() => {
    function onVisible() {
      if (!document.hidden && pendingApplyJob.current) {
        setApplyDialog(pendingApplyJob.current);
        pendingApplyJob.current = null;
      }
    }
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  // Kick off a fresh fetch from the empty state (same as the Dashboard "Run now").
  async function runFetch() {
    setFetching(true);
    setBulkMsg('Starting a fetch…');
    try {
      const r = await fetch('/api/run', { method: 'POST' });
      const d = await r.json();
      setBulkMsg(r.ok ? 'Fetch started — new jobs appear here in a few minutes and score automatically.' : `Error: ${d.error || 'could not start a fetch'}`);
    } catch {
      setBulkMsg('Could not start a fetch.');
    } finally {
      setFetching(false);
      setTimeout(() => setBulkMsg(null), 8000);
    }
  }

  function resetFilters() {
    setSearch('');
    setStatus('all');
    setMinScore('6');
    setMaxScore('');
    setMinSkill('');
    setEmploymentType('');
    setCompanyTier('good,medium');
    setEasyApply(null);
    setHideApplied(true);
    setHideOpened(false);
    setHideInApplications(true);
    setSelectedRunIds([]);
  }

  async function patch(id: string, body: Record<string, unknown>) {
    await fetch(`/api/jobs/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    load();
  }

  async function deleteJob(id: string) {
    if (!confirm('Are you sure you want to delete this job permanently?')) return;
    await fetch(`/api/jobs/${id}`, { method: 'DELETE' });
    load();
    refreshStats();
  }

  // Apply-tracking + "opened" tint. The navigation itself is a real <a target="_blank">
  // (see the row) — far more reliable than window.open, which browsers popup-block
  // on repeat opens (the "already-opened job won't reopen" glitch).
  function markOpened(job: Job) {
    pendingApplyJob.current = job;
    if (!job.clicked_at) {
      const now = new Date().toISOString();
      setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, clicked_at: now } : j)));
      fetch(`/api/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clicked_at: now }),
      }).catch(() => {});
    }
  }

  // ── Bulk selection ─────────────────────────────────────────────────────────
  const allSelected = jobs.length > 0 && jobs.every((j) => selected.has(j.id));

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleSelectAll() {
    setSelected(allSelected ? new Set() : new Set(jobs.map((j) => j.id)));
  }
  /** Select EVERY job matching the current filter (not just the visible page) — for bulk actions over 300+. */
  async function selectAllMatching() {
    setBulkBusy(true);
    setBulkMsg('Selecting all matching…');
    try {
      const p = buildParams();
      p.set('idsOnly', 'true');
      const d = await fetch(`/api/jobs?${p.toString()}`).then((r) => r.json());
      const ids: string[] = d.ids ?? [];
      setSelected(new Set(ids));
      setBulkMsg(`Selected ${ids.length} matching job${ids.length === 1 ? '' : 's'}.`);
    } catch {
      setBulkMsg('Could not select all matching.');
    } finally {
      setBulkBusy(false);
    }
  }
  /** All selected ids (may include off-page rows from "select all matching"); the
   *  bulk endpoints resolve jobs by id server-side, so off-screen ids are fine. */
  function selectedVisibleIds(): string[] {
    return [...selected];
  }

  // AI-score exactly the picked jobs (chunked to stay under the serverless timeout).
  async function scoreSelected() {
    const ids = selectedVisibleIds();
    if (ids.length === 0 || bulkBusy || bulkRunning) return;
    setBulkBusy(true);
    let scored = 0;
    let filtered = 0;
    let done = 0;
    setBulkProgress({ label: 'AI-scoring selected jobs', done: 0, total: ids.length, phase: 'running', tone: 'sky' });
    try {
      for (let i = 0; i < ids.length; i += 5) {
        const chunk = ids.slice(i, i + 5);
        const d = await fetch('/api/score-selected', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: chunk }),
        }).then((r) => r.json());
        scored += d.scored ?? 0;
        filtered += d.filtered ?? 0;
        done += chunk.length;
        setBulkProgress({ label: 'AI-scoring selected jobs', done, total: ids.length, phase: 'running', tone: 'sky' });
        load(); // scores light up live as each chunk lands
      }
      setBulkProgress({ label: `Done — ${scored} scored${filtered ? `, ${filtered} filtered` : ''}`, done: ids.length, total: ids.length, phase: 'done', tone: 'sky' });
      setSelected(new Set());
      load();
      refreshStats();
    } catch {
      setBulkProgress({ label: 'Scoring failed', done, total: ids.length, phase: 'done', tone: 'sky' });
    } finally {
      setBulkBusy(false);
    }
  }

  async function archiveSelected() {
    const ids = selectedVisibleIds();
    if (ids.length === 0 || bulkBusy) return;
    setBulkBusy(true);
    setBulkMsg('Archiving…');
    try {
      await Promise.all(
        ids.map((id) =>
          fetch(`/api/jobs/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'archived' }),
          }),
        ),
      );
      setBulkMsg(`Archived ${ids.length}.`);
      setSelected(new Set());
      load();
      refreshStats();
    } catch {
      setBulkMsg('Archive failed.');
    } finally {
      setBulkBusy(false);
      setTimeout(() => setBulkMsg(null), 5000);
    }
  }

  async function markAppliedSelected() {
    const ids = selectedVisibleIds();
    if (ids.length === 0 || bulkBusy) return;
    setBulkBusy(true);
    setBulkMsg('Marking applied…');
    try {
      const now = new Date().toISOString();
      await Promise.all(
        ids.map((id) =>
          fetch(`/api/jobs/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ applied_at: now }),
          }),
        ),
      );
      setBulkMsg(`Marked ${ids.length} applied.`);
      setSelected(new Set());
      load();
      refreshStats();
    } catch {
      setBulkMsg('Failed to mark applied.');
    } finally {
      setBulkBusy(false);
      setTimeout(() => setBulkMsg(null), 5000);
    }
  }

  // AI-assess the companies behind the picked jobs (chunked, like scoreSelected).
  // Re-runs even on already-assessed jobs (overwrites the tier) — this IS the reassess path.
  async function assessSelected() {
    const ids = selectedVisibleIds();
    if (ids.length === 0 || bulkBusy || bulkRunning) return;
    // One LLM call per job — guard against an accidental huge re-run.
    if (ids.length > 20 && !confirm(`Assess / re-assess ${ids.length} companies? This runs one AI call per job and re-rates any that were already assessed.`)) return;
    setBulkBusy(true);
    let assessed = 0;
    let done = 0;
    setBulkProgress({ label: 'AI-assessing companies', done: 0, total: ids.length, phase: 'running', tone: 'violet' });
    try {
      for (let i = 0; i < ids.length; i += 5) {
        const chunk = ids.slice(i, i + 5);
        const d = await fetch('/api/company-check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: chunk }),
        }).then((r) => r.json());
        assessed += d.assessed ?? 0;
        done += chunk.length;
        setBulkProgress({ label: 'AI-assessing companies', done, total: ids.length, phase: 'running', tone: 'violet' });
        load(); // tiers light up live as each chunk lands
      }
      setBulkProgress({ label: `Done — assessed ${assessed} compan${assessed === 1 ? 'y' : 'ies'}`, done: ids.length, total: ids.length, phase: 'done', tone: 'violet' });
      setSelected(new Set());
      load();
    } catch {
      setBulkProgress({ label: 'Company assessment failed', done, total: ids.length, phase: 'done', tone: 'violet' });
    } finally {
      setBulkBusy(false);
    }
  }

  // Queue the selected jobs into the Tailor & Apply section (idempotent server-side).
  async function addToApplications() {
    const ids = selectedVisibleIds();
    if (ids.length === 0 || bulkBusy) return;
    setBulkBusy(true);
    setBulkMsg('Sending to Tailor & Apply…');
    try {
      const d = await fetch('/api/applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      }).then((r) => r.json());
      const added = d.added ?? 0;
      const dupes = ids.length - added;
      setBulkMsg(`Sent ${added} to Tailor & Apply${dupes > 0 ? ` (${dupes} already there)` : ''}.`);
      setSelected(new Set());
      // They now live under Tailor & Apply — drop them out of this list (when hidden).
      if (hideInApplications) load();
    } catch {
      setBulkMsg('Could not send to Tailor & Apply.');
    } finally {
      setBulkBusy(false);
      setTimeout(() => setBulkMsg(null), 6000);
    }
  }

  async function deleteSelected() {
    const ids = selectedVisibleIds();
    if (ids.length === 0 || bulkBusy) return;
    if (!confirm(`Are you sure you want to delete the ${ids.length} selected jobs permanently?`)) return;
    setBulkBusy(true);
    setBulkMsg('Deleting…');
    try {
      await Promise.all(
        ids.map((id) =>
          fetch(`/api/jobs/${id}`, {
            method: 'DELETE',
          }),
        ),
      );
      setBulkMsg(`Deleted ${ids.length} jobs.`);
      setSelected(new Set());
      load();
      refreshStats();
    } catch {
      setBulkMsg('Delete failed.');
    } finally {
      setBulkBusy(false);
      setTimeout(() => setBulkMsg(null), 5000);
    }
  }

  async function markApplied(job: Job) {
    setApplyDialog(null);
    await patch(job.id, { applied_at: new Date().toISOString() });
  }

  return (
    <div className="p-4 sm:p-6 lg:p-7 animate-slide-up">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-text tracking-tight">Jobs</h1>
          <p className="text-slate-muted text-[13px] mt-1">
            {total} shown · last 24h · sorted by fit score ·{' '}
            <Link href="/past" className="text-sky hover:underline inline-flex items-center gap-1">
              <History size={12} /> Past jobs
            </Link>
          </p>
        </div>
      </div>

      {/* Live progress of the *automatic* scorer (daily run / webhook loop), if active. */}
      <ScoringPanel onActivity={() => { load(); refreshStats(); }} />

      {/* Re-scoring safety gate is ON (ADR 0039) — make it visible so it's deliberate. */}
      {allowRescore && (
        <div className="flex items-center gap-2 mb-4 px-3 py-2 rounded-md bg-amber-500/10 border border-amber-500/30 text-[12px] text-amber-400">
          <AlertTriangle size={14} className="shrink-0" />
          <span>
            Re-scoring is <strong>ON</strong> — “Score selected” will overwrite existing scores. Turn it off in{' '}
            <Link href="/settings" className="underline hover:text-amber-300">Settings</Link> when you&apos;re done.
          </span>
        </div>
      )}

      {/* The selection-based scoring / assessment progress toast is rendered globally by
          ProgressProvider so it stays pinned across tab switches. */}

      {/* Run selector */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative" ref={runsDropdownRef}>
          <button
            type="button"
            onClick={() => setShowRunsDropdown((v) => !v)}
            className={`px-3 py-1.5 rounded-md text-[12px] flex items-center gap-2 transition-colors border ${
              showRunsDropdown || selectedRunIds.length > 0
                ? 'bg-sky/10 border-sky/30 text-sky'
                : 'bg-card border-ink text-slate-text hover:bg-raised'
            }`}
          >
            {selectedRunIds.length === 0 ? 'All runs' : `${selectedRunIds.length} run${selectedRunIds.length > 1 ? 's' : ''} selected`}
            <ChevronDown size={13} className={`transition-transform ${showRunsDropdown ? 'rotate-180' : ''}`} />
          </button>
          {showRunsDropdown && (
            <div className="absolute left-0 mt-1.5 z-50 bg-card border border-ink rounded-xl shadow-2xl overflow-hidden w-72 animate-fade-in">
              <div className="px-3 py-2 border-b border-ink-subtle flex justify-between items-center">
                <span className="text-[10px] uppercase tracking-wider text-slate-muted font-medium">Filter by run</span>
                {selectedRunIds.length > 0 && (
                  <button type="button" onClick={() => setSelectedRunIds([])} className="text-[11px] text-slate-muted hover:text-sky">
                    Clear
                  </button>
                )}
              </div>
              <div className="max-h-64 overflow-y-auto py-1">
                {runs.length === 0 ? (
                  <div className="px-3 py-2 text-slate-muted text-[11px]">No runs found</div>
                ) : (
                  runs.map((run) => {
                    const checked = selectedRunIds.includes(run.id);
                    return (
                      <label
                        key={run.id}
                        className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer select-none text-[12px] transition-colors ${
                          checked ? 'bg-sky/5 text-slate-text' : 'text-slate-muted hover:bg-raised hover:text-slate-text'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setSelectedRunIds((prev) => (checked ? prev.filter((id) => id !== run.id) : [...prev, run.id]))
                          }
                          className="w-3.5 h-3.5 rounded border-ink text-sky focus:ring-sky bg-raised shrink-0 cursor-pointer"
                        />
                        <span className="truncate">{formatRunLabel(run)}</span>
                      </label>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
        {selectedRunIds.length > 0 && (
          <div className="flex flex-wrap gap-1.5 items-center">
            {selectedRunIds.map((id) => {
              const run = runs.find((r) => r.id === id);
              if (!run) return null;
              return (
                <span
                  key={id}
                  className="flex items-center gap-1.5 text-[11px] text-sky bg-sky/10 border border-sky/20 px-2.5 py-1 rounded-md"
                >
                  {formatRunLabel(run)}
                  <button
                    onClick={() => setSelectedRunIds((prev) => prev.filter((rid) => rid !== id))}
                    className="text-sky/50 hover:text-rose transition-colors ml-1 leading-none"
                  >
                    ×
                  </button>
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* Filters — search + Fit + Company stay up front; everything else folds into
          "More filters" so the bar isn't a wall of dropdowns. Active refinements still
          surface as chips below and as a count on the toggle. */}
      <div className="space-y-3 mb-5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-muted" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search title, company, location…"
              className="pl-8 pr-3 py-1.5 w-full bg-card border border-ink rounded-md text-[13px] text-slate-text placeholder:text-slate-muted focus:border-sky/40 outline-none"
            />
          </div>

          {/* Fit-score RANGE — set a min and/or max so you can isolate any band (e.g. ≤ 5
              to find low-fit jobs to delete, or 7–7 for exactly 7), not just "≥ N". */}
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-card border border-ink rounded-md" title="Filter by fit-score range">
            <span className="text-[12px] text-slate-muted">Fit</span>
            <select
              value={minScore}
              onChange={(e) => changeMinScore(e.target.value)}
              title="Minimum fit score"
              className="bg-transparent text-[12px] text-slate-text outline-none cursor-pointer"
            >
              <option value="">min</option>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                <option key={n} value={n}>≥ {n}</option>
              ))}
            </select>
            <span className="text-[12px] text-slate-muted">–</span>
            <select
              value={maxScore}
              onChange={(e) => changeMaxScore(e.target.value)}
              title="Maximum fit score"
              className="bg-transparent text-[12px] text-slate-text outline-none cursor-pointer"
            >
              <option value="">max</option>
              {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                <option key={n} value={n}>≤ {n}</option>
              ))}
            </select>
          </div>

          <select
            value={companyTier}
            onChange={(e) => setCompanyTier(e.target.value)}
            title="Filter by AI company assessment"
            className="px-3 py-1.5 bg-card border border-ink rounded-md text-[12px] text-slate-text outline-none focus:border-sky/40"
          >
            <option value="good,medium">Company: Good or Medium</option>
            <option value="">Any company</option>
            <option value="good">Company: Good</option>
            <option value="medium">Company: Medium</option>
            <option value="low">Company: Low</option>
            <option value="unknown">Company: Unknown</option>
            <option value="none">Company: Not assessed</option>
          </select>

          {/* Fold the secondary refinements away by default — a badge keeps any active
              ones from hiding silently. */}
          <button
            type="button"
            onClick={toggleMoreFilters}
            title="Apply type, skill match, role type, and hide rules"
            className={`flex items-center gap-1.5 px-3 py-1.5 text-[12px] rounded-md border transition-all ${
              showMoreFilters || moreFilterCount > 0 ? 'bg-sky/10 border-sky/30 text-sky' : 'text-slate-muted border-ink hover:text-slate-text hover:bg-raised'
            }`}
          >
            <SlidersHorizontal size={13} /> More filters
            {moreFilterCount > 0 && (
              <span className="px-1.5 py-px text-[10px] font-mono rounded bg-sky/20 text-sky">{moreFilterCount}</span>
            )}
            <ChevronDown size={13} className={`transition-transform ${showMoreFilters ? 'rotate-180' : ''}`} />
          </button>

          <button onClick={resetFilters} className="ml-auto text-[12px] text-slate-muted hover:text-sky underline">
            Reset
          </button>
        </div>

        <div className="flex gap-1 flex-wrap">
          {STATUSES.map((st) => (
            <button
              key={st}
              onClick={() => setStatus(st)}
              title={STATUS_HELP[st]}
              className={`px-3 py-1.5 text-[12px] rounded-md border capitalize transition-all ${
                status === st
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

        {showMoreFilters && (
        <div className="flex flex-wrap items-center gap-2 p-3 bg-card/40 border border-ink-subtle rounded-lg animate-fade-in">
          <select
            value={easyApply === null ? '' : easyApply ? 'easy' : 'external'}
            onChange={(e) => setEasyApply(e.target.value === '' ? null : e.target.value === 'easy')}
            title="Filter by how you apply"
            className="px-3 py-1.5 bg-card border border-ink rounded-md text-[12px] text-slate-text outline-none focus:border-sky/40"
          >
            <option value="">Any apply type</option>
            <option value="easy">Easy Apply</option>
            <option value="external">External</option>
          </select>

          <select
            value={minSkill}
            onChange={(e) => {
              const v = e.target.value;
              setMinSkill(v);
              // "No skill match" is for finding junk to delete — relax score/company so they all show.
              if (v === '0') {
                setMinScore('');
                setMaxScore('');
                setCompanyTier('');
              }
            }}
            title="Filter by skill match (how many of your skills the job mentions)"
            className="px-3 py-1.5 bg-card border border-ink rounded-md text-[12px] text-slate-text outline-none focus:border-sky/40"
          >
            <option value="">Any skill match</option>
            <option value="0">No skill match (0%)</option>
            <option value="1">Has a match (≥ 1%)</option>
            <option value="34">Skill match ≥ 34%</option>
            <option value="67">Skill match ≥ 67%</option>
            <option value="100">Skill match = 100%</option>
          </select>

          <select
            value={employmentType}
            onChange={(e) => setEmploymentType(e.target.value)}
            title="Filter by role type (contract / full-time)"
            className="px-3 py-1.5 bg-card border border-ink rounded-md text-[12px] text-slate-text outline-none focus:border-sky/40"
          >
            <option value="">Any type</option>
            <option value="full_time">Full-time</option>
            <option value="contract">Contract</option>
            <option value="internship">Internship</option>
          </select>

          <span className="hidden sm:block w-px h-5 bg-ink mx-1" />

          <label
            title="Hide jobs you've already applied to (still under the Applied tab)"
            className={`flex items-center gap-1.5 px-3 py-1.5 text-[12px] rounded-md border cursor-pointer select-none transition-all ${
              hideApplied && status !== 'applied' ? 'bg-sky-glow text-sky border-sky/30' : 'text-slate-muted border-ink hover:text-slate-text hover:bg-raised'
            } ${status === 'applied' ? 'opacity-40 pointer-events-none' : ''}`}
          >
            <input
              type="checkbox"
              checked={hideApplied && status !== 'applied'}
              onChange={(e) => setHideApplied(e.target.checked)}
              className="w-3.5 h-3.5 rounded border-ink text-sky focus:ring-sky bg-raised"
            />
            Hide applied
          </label>

          <label
            title="Hide jobs you opened but didn't apply to (ones you've already looked at)"
            className={`flex items-center gap-1.5 px-3 py-1.5 text-[12px] rounded-md border cursor-pointer select-none transition-all ${
              hideOpened && status !== 'opened' ? 'bg-sky-glow text-sky border-sky/30' : 'text-slate-muted border-ink hover:text-slate-text hover:bg-raised'
            } ${status === 'opened' ? 'opacity-40 pointer-events-none' : ''}`}
          >
            <input
              type="checkbox"
              checked={hideOpened && status !== 'opened'}
              onChange={(e) => setHideOpened(e.target.checked)}
              className="w-3.5 h-3.5 rounded border-ink text-sky focus:ring-sky bg-raised"
            />
            Hide opened
          </label>

          <label
            title="Hide jobs you've already sent to Tailor & Apply"
            className={`flex items-center gap-1.5 px-3 py-1.5 text-[12px] rounded-md border cursor-pointer select-none transition-all ${
              hideInApplications ? 'bg-sky-glow text-sky border-sky/30' : 'text-slate-muted border-ink hover:text-slate-text hover:bg-raised'
            }`}
          >
            <input
              type="checkbox"
              checked={hideInApplications}
              onChange={(e) => setHideInApplications(e.target.checked)}
              className="w-3.5 h-3.5 rounded border-ink text-sky focus:ring-sky bg-raised"
            />
            Hide in Tailor &amp; Apply
          </label>
        </div>
        )}

        {/* Active-filter summary: the whole combination at a glance, clear any one */}
        {(() => {
          const chips: { key: string; label: string; clear: () => void }[] = [];
          if (search) chips.push({ key: 'q', label: `“${search}”`, clear: () => setSearch('') });
          if (status !== 'all') chips.push({ key: 'st', label: `Status: ${status}`, clear: () => setStatus('all') });
          if (minScore && !scoreless) chips.push({ key: 'sc', label: `Fit ≥ ${minScore}`, clear: () => setMinScore('') });
          if (maxScore && !scoreless) chips.push({ key: 'scx', label: `Fit ≤ ${maxScore}`, clear: () => setMaxScore('') });
          if (minSkill)
            chips.push({
              key: 'sk',
              label: minSkill === '0' ? 'Skill: no match' : minSkill === '100' ? 'Skill: 100%' : `Skill ≥ ${minSkill}%`,
              clear: () => setMinSkill(''),
            });
          if (companyTier && !scoreless) chips.push({ key: 'co', label: `Company: ${COMPANY_LABEL[companyTier] ?? companyTier}`, clear: () => setCompanyTier('') });
          if (employmentType) chips.push({ key: 'em', label: EMPLOYMENT_LABEL[employmentType] ?? employmentType, clear: () => setEmploymentType('') });
          if (easyApply !== null) chips.push({ key: 'ea', label: easyApply ? 'Easy Apply' : 'External', clear: () => setEasyApply(null) });
          if (hideApplied && status !== 'applied') chips.push({ key: 'ha', label: 'Hiding applied', clear: () => setHideApplied(false) });
          if (hideOpened && status !== 'opened') chips.push({ key: 'ho', label: 'Hiding opened', clear: () => setHideOpened(false) });
          if (hideInApplications) chips.push({ key: 'hia', label: 'Hiding in Tailor & Apply', clear: () => setHideInApplications(false) });
          if (selectedRunIds.length) chips.push({ key: 'ru', label: `${selectedRunIds.length} run${selectedRunIds.length > 1 ? 's' : ''}`, clear: () => setSelectedRunIds([]) });
          if (chips.length === 0) return null;
          return (
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              <span className="text-[11px] text-slate-muted">Active:</span>
              {chips.map((c) => (
                <span key={c.key} className="flex items-center gap-1 pl-2 pr-1 py-0.5 text-[11px] bg-sky/10 border border-sky/25 text-sky rounded">
                  {c.label}
                  <button onClick={c.clear} title="Remove this filter" className="text-sky/60 hover:text-rose px-0.5 leading-none">
                    ×
                  </button>
                </span>
              ))}
              <button onClick={resetFilters} className="text-[11px] text-slate-muted hover:text-sky underline ml-1">
                Clear all
              </button>
            </div>
          );
        })()}
      </div>

      <JobsLegend />

      {/* Selection toolbar — pick specific jobs and act on just those */}
      {!loading && jobs.length > 0 && (
        <div className="flex items-center gap-3 mb-3 flex-wrap">
          <label className="flex items-center gap-2 text-[12px] text-slate-muted cursor-pointer select-none">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleSelectAll}
              className="w-4 h-4 rounded border-ink text-sky focus:ring-sky bg-raised"
            />
            {selected.size > 0 ? `${selected.size} selected` : `Select all (${jobs.length})`}
          </label>
          {total > jobs.length && (
            <button
              onClick={selectAllMatching}
              disabled={bulkBusy}
              title="Select every job matching the current filter, across all pages"
              className="text-[12px] text-sky hover:text-sky/80 underline disabled:opacity-40"
            >
              Select all {total} matching
            </button>
          )}
          {selected.size > 0 && (
            <>
              <button
                onClick={scoreSelected}
                disabled={bulkBusy || bulkRunning}
                title={
                  allowRescore
                    ? 'Re-score the selected jobs — overwrites existing scores (re-scoring is ON in Settings)'
                    : 'AI-score just the selected jobs (already-scored ones are skipped; skips the auto pre-filter)'
                }
                className={`flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium border disabled:opacity-40 rounded-md transition-all ${
                  allowRescore
                    ? 'text-amber-400 bg-amber-500/10 border-amber-500/30 hover:bg-amber-500/20'
                    : 'text-sky bg-sky/10 border-sky/30 hover:bg-sky/20'
                }`}
              >
                <Sparkles size={13} /> {allowRescore ? 'Re-score' : 'Score'} selected ({selected.size})
              </button>
              <button
                onClick={assessSelected}
                disabled={bulkBusy || bulkRunning}
                title="AI-assess the selected companies — re-runs even on jobs already rated, so use this to re-assess too"
                className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-sky bg-sky/10 border border-sky/30 hover:bg-sky/20 disabled:opacity-40 rounded-md transition-all"
              >
                <Building2 size={13} /> Assess / re-assess ({selected.size})
              </button>
              <button
                onClick={addToApplications}
                disabled={bulkBusy}
                title="Send the selected jobs to Tailor & Apply to prepare a tailored résumé"
                className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-violet-300 bg-violet-500/10 border border-violet-500/30 hover:bg-violet-500/20 disabled:opacity-40 rounded-md transition-all"
              >
                <FileText size={13} /> Send to Tailor &amp; Apply ({selected.size})
              </button>
              <button
                onClick={markAppliedSelected}
                disabled={bulkBusy}
                title="Mark the selected jobs as applied"
                className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-emerald border border-emerald/30 bg-emerald/10 hover:bg-emerald/20 disabled:opacity-40 rounded-md transition-all"
              >
                <CheckCircle2 size={13} /> Mark applied
              </button>
              <button
                onClick={archiveSelected}
                disabled={bulkBusy}
                title="Archive the selected jobs"
                className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-slate-muted border border-ink hover:text-rose hover:border-rose/30 disabled:opacity-40 rounded-md transition-all"
              >
                <Archive size={13} /> Archive selected
              </button>
              <button
                onClick={deleteSelected}
                disabled={bulkBusy}
                title="Delete the selected jobs permanently"
                className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-slate-muted border border-ink hover:text-rose hover:border-rose/30 disabled:opacity-40 rounded-md transition-all"
              >
                <Trash2 size={13} /> Delete selected
              </button>
              <button onClick={() => setSelected(new Set())} className="text-[12px] text-slate-muted hover:text-slate-text underline">
                Clear
              </button>
            </>
          )}
          {bulkMsg && <span className="text-[12px] text-slate-muted animate-fade-in">{bulkMsg}</span>}
        </div>
      )}

      <div className="bg-card border border-ink rounded-xl overflow-hidden">
        {loading ? (
          <div className="px-5 py-10 text-center text-slate-muted text-[13px]">Loading…</div>
        ) : jobs.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <h3 className="text-[14px] font-medium text-slate-text mb-2">No jobs found in the last 24 hours</h3>
            <p className="text-[13px] text-slate-muted mb-6 max-w-md mx-auto">
              This list strictly shows jobs discovered in the last 24 hours. If your filters aren't hiding them, it's time to run a fresh fetch.
            </p>
            <button
              onClick={runFetch}
              disabled={fetching}
              className="inline-flex items-center justify-center px-4 py-2 text-[13px] font-medium text-sky bg-sky/10 border border-sky/30 hover:bg-sky/20 rounded-lg transition-all disabled:opacity-50"
            >
              {fetching ? 'Starting fetch...' : 'Run a fetch now'}
            </button>
          </div>
        ) : (
          <div className="divide-y divide-ink-subtle">
            {jobs.map((job) => {
              const open = expanded === job.id;
              return (
                <div key={job.id}>
                  <div
                    className={`flex items-center gap-4 px-5 py-3 transition-colors ${
                      selected.has(job.id)
                        ? 'bg-sky/5'
                        : job.clicked_at && !job.applied_at
                        ? 'bg-violet-500/[0.07] hover:bg-violet-500/10'
                        : 'hover:bg-raised'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(job.id)}
                      onChange={() => toggleOne(job.id)}
                      title="Select"
                      className="w-4 h-4 rounded border-ink text-sky focus:ring-sky bg-raised shrink-0"
                    />
                    <button onClick={() => setExpanded(open ? null : job.id)} className="text-slate-muted hover:text-sky">
                      {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                    </button>
                    <ScoreBadge score={job.fit_score} />
                    <div className="flex-1 min-w-0">
                      <p className="text-slate-text text-[13px] font-medium truncate">{job.title}</p>
                      <p className="text-slate-muted text-[11px] truncate">
                        {job.company} · {job.location || 'Unknown'}
                        {job.salary ? ` · ${job.salary}` : ''}
                        {job.company_size ? ` · ${job.company_size}` : ''}
                      </p>
                    </div>

                    {/* Contract / role-type badge (ADR 0022) — flagged, not demoted */}
                    {job.employment_type === 'contract' && (
                      <span title="Contract / staffing role — review separately" className="shrink-0 hidden sm:inline px-1.5 py-0.5 text-[10px] font-medium bg-violet-500/10 border border-violet-500/25 text-violet-300 rounded">
                        Contract
                      </span>
                    )}
                    {job.employment_type === 'internship' && (
                      <span title="Internship" className="shrink-0 hidden sm:inline px-1.5 py-0.5 text-[10px] font-medium bg-raised border border-ink text-slate-muted rounded">
                        Intern
                      </span>
                    )}

                    {/* Apply type badge */}
                    {job.easy_apply === true && (
                      <span title="One-click apply on LinkedIn" className="shrink-0 hidden sm:inline px-1.5 py-0.5 text-[10px] font-medium bg-emerald/10 border border-emerald/25 text-emerald rounded">
                        Easy Apply
                      </span>
                    )}
                    {job.easy_apply === false && (
                      <span title="Apply on the company / external site" className="shrink-0 hidden sm:inline px-1.5 py-0.5 text-[10px] font-medium bg-amber-500/10 border border-amber-500/25 text-amber-400 rounded">
                        External
                      </span>
                    )}

                    {/* AI company-tier badge */}
                    {job.company_tier && (
                      <CompanyTierBadge tier={job.company_tier} note={job.company_tier_note} className="shrink-0 hidden sm:inline-flex" />
                    )}

                    {/* Skill-match badge (resumeKeywords) */}
                    {job.skill_match_score != null && (
                      <SkillMatchBadge score={job.skill_match_score} matched={job.matched_skills} className="shrink-0 hidden sm:inline-flex" />
                    )}

                    {/* Opened (clicked but not yet applied) badge */}
                    {job.clicked_at && !job.applied_at && (
                      <span className="shrink-0 hidden sm:inline px-1.5 py-0.5 text-[10px] font-medium bg-violet-500/10 border border-violet-500/25 text-violet-300 rounded">
                        Opened
                      </span>
                    )}

                    {/* Applied badge */}
                    {job.applied_at && (
                      <span title={`Applied ${new Date(job.applied_at).toLocaleDateString()}`} className="shrink-0 text-emerald">
                        <CheckCircle2 size={15} />
                      </span>
                    )}

                    {job.score_note && (
                      <p className="hidden lg:block max-w-xs truncate text-slate-muted text-[11px] italic">{job.score_note}</p>
                    )}
                    <button
                      onClick={() => patch(job.id, { is_shortlisted: !job.is_shortlisted })}
                      title="Shortlist"
                      className={job.is_shortlisted ? 'text-emerald' : 'text-slate-muted hover:text-emerald'}
                    >
                      <Star size={15} fill={job.is_shortlisted ? 'currentColor' : 'none'} />
                    </button>
                    <a
                      href={job.application_url || job.url || '#'}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => markOpened(job)}
                      title="Open posting (will ask if you applied)"
                      className="text-slate-muted hover:text-sky"
                    >
                      <ExternalLink size={15} />
                    </a>
                    {job.status !== 'archived' && (
                      <button
                        onClick={() => patch(job.id, { status: 'archived' })}
                        title="Archive"
                        className="text-slate-muted hover:text-rose"
                      >
                        <Archive size={15} />
                      </button>
                    )}
                    <button
                      onClick={() => deleteJob(job.id)}
                      title="Delete permanently"
                      className="text-slate-muted hover:text-rose"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>

                  {open && <JobDetails job={job} onPatch={patch} />}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Pagination: how many are shown vs match, with a Load more. */}
      {!loading && jobs.length > 0 && (
        <div className="flex items-center justify-center gap-3 mt-4 text-[12px] text-slate-muted">
          <span>Showing {jobs.length} of {total}</span>
          {jobs.length < total && (
            <button
              onClick={() => setLimit((n) => n + 300)}
              className="px-3 py-1.5 text-sky border border-sky/30 bg-sky/5 hover:bg-sky/15 rounded-md transition-all"
            >
              Load more
            </button>
          )}
        </div>
      )}

      {/* "Did you apply?" dialog — fixed bottom-right, shown after returning from an external link */}
      {applyDialog && (
        <div className="fixed bottom-5 right-5 z-50 bg-card border border-ink rounded-xl p-4 shadow-2xl w-80 animate-slide-up">
          <p className="text-[13px] font-semibold text-slate-text mb-0.5">Did you apply?</p>
          <p className="text-[12px] text-slate-muted mb-4 truncate">
            {applyDialog.title}
            {applyDialog.company ? ` · ${applyDialog.company}` : ''}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => markApplied(applyDialog)}
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
