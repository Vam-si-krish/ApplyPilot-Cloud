'use client';

import { useEffect, useState } from 'react';
import {
  Save, CheckCircle, AlertCircle, Trash2, Plus, X, Mail, Check, ExternalLink, LogOut,
  Search, Clock3, Sparkles, KeyRound, SlidersHorizontal, ArrowRight,
} from 'lucide-react';
import type { Settings, ApiKeyMasked, ApiKeyProvider, GmailStatus } from '@/lib/types';

const PROVIDERS = [
  { id: 'gemini', label: 'Google Gemini', model: 'gemini-2.0-flash' },
  { id: 'openai', label: 'OpenAI', model: 'gpt-4o-mini' },
  { id: 'deepseek', label: 'DeepSeek', model: 'deepseek-chat' },
  { id: 'anthropic', label: 'Anthropic Claude', model: 'claude-sonnet-4-6' },
  // ADR 0042: run the task on your Claude subscription via the Agent SDK on the
  // worker — no API key billed (uses the plan's monthly Agent-SDK credit).
  { id: 'subscription', label: 'Claude subscription (no API key)', model: 'sonnet' },
  // ADR 0069: run the task through the Codex SDK authenticated with `codex login`
  // on the worker. This consumes the user's ChatGPT plan instead of a vault API key.
  { id: 'chatgpt_subscription', label: 'ChatGPT subscription (no API key)', model: 'gpt-5.6-terra' },
];

// Known models per provider — shown as dropdown options. A "Custom…" option keeps the
// field open-ended so any other model id still works.
const MODELS: Record<string, string[]> = {
  openai: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1'],
  anthropic: ['claude-sonnet-4-6', 'claude-haiku-4-5-20251001', 'claude-opus-4-8'],
  gemini: ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-2.5-pro'],
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  // Agent-SDK model aliases (resolve to the current Claude models on the worker).
  subscription: ['sonnet', 'opus', 'haiku'],
  // Public model ids accepted by Codex with a ChatGPT login (learn.chatgpt.com/docs/models,
  // 2026-07: the GPT-5.6 tiers + previous-gen 5.5; 5.4/5.4-mini are legacy). Custom remains
  // available for account-specific or newly released models without requiring an app deploy.
  chatgpt_subscription: ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5'],
};
// Friendly labels for the dropdown (falls back to the raw id for anything unlisted).
const MODEL_LABELS: Record<string, string> = {
  'gpt-4o-mini': 'GPT-4o mini', 'gpt-4o': 'GPT-4o', 'gpt-4.1-mini': 'GPT-4.1 mini', 'gpt-4.1': 'GPT-4.1',
  'claude-haiku-4-5-20251001': 'Claude Haiku 4.5', 'claude-sonnet-4-6': 'Claude Sonnet 4.6', 'claude-opus-4-8': 'Claude Opus 4.8',
  'gemini-2.0-flash': 'Gemini 2.0 Flash', 'gemini-2.5-flash': 'Gemini 2.5 Flash', 'gemini-2.5-pro': 'Gemini 2.5 Pro',
  'deepseek-chat': 'DeepSeek Chat', 'deepseek-reasoner': 'DeepSeek Reasoner',
  sonnet: 'Claude Sonnet (latest)', opus: 'Claude Opus (latest)', haiku: 'Claude Haiku (latest)',
  'gpt-5.6-sol': 'GPT-5.6 Sol (flagship)', 'gpt-5.6-terra': 'GPT-5.6 Terra (balanced)',
  'gpt-5.6-luna': 'GPT-5.6 Luna (fast)', 'gpt-5.5': 'GPT-5.5', 'gpt-5.4': 'GPT-5.4 (legacy)',
};
const CUSTOM_MODEL = '__custom__';
const defaultModel = (provider: string) => MODELS[provider]?.[0] ?? '';

// Common timezones for the Schedule picker (IANA values; labels show the US name).
// A saved value not in this list is preserved as an extra option (see the select).
const TIMEZONE_OPTIONS: { value: string; label: string }[] = [
  { value: 'America/New_York', label: 'Eastern (America/New_York)' },
  { value: 'America/Chicago', label: 'Central (America/Chicago)' },
  { value: 'America/Denver', label: 'Mountain (America/Denver)' },
  { value: 'America/Phoenix', label: 'Arizona, no DST (America/Phoenix)' },
  { value: 'America/Los_Angeles', label: 'Pacific (America/Los_Angeles)' },
  { value: 'America/Anchorage', label: 'Alaska (America/Anchorage)' },
  { value: 'Pacific/Honolulu', label: 'Hawaii (Pacific/Honolulu)' },
  { value: 'UTC', label: 'UTC' },
];

const ACTORS = [
  { id: 'cheap_scraper~linkedin-job-scraper', label: 'Pay per result — recommended (cheap_scraper)' },
  { id: 'bebity~linkedin-jobs-scraper', label: 'Paid rental — $29.99/mo + usage (bebity)' },
  { id: 'fascinating_lentil~linkedin-jobs-scraper', label: 'Alternative (fascinating_lentil)' },
];

// LinkedIn f_E facet (ADR 0058). Mirrors LINKEDIN_EXPERIENCE_LEVELS in lib/apify.ts,
// which is server-only (its module pulls in the service-role Supabase client).
const EXPERIENCE_LEVELS = [
  { value: '1', label: 'Internship' },
  { value: '2', label: 'Entry level' },
  { value: '3', label: 'Associate' },
  { value: '4', label: 'Mid-Senior' },
  { value: '5', label: 'Director' },
  { value: '6', label: 'Executive' },
];

// One-click suggestions to seed the libraries (ADR 0016). Adding one drops it into
// the saved list; it persists and can be selected/deselected like any other.
const KEYWORD_SUGGESTIONS = [
  'Software Engineer', 'Backend Engineer', 'Frontend Engineer', 'Full Stack Engineer',
  'Data Engineer', 'Machine Learning Engineer', 'DevOps Engineer', 'Platform Engineer',
];
// Owner-neutral location suggestions. Onboarding seeds each account's own résumé
// location; these are only broad shortcuts and never override that per-user list.
const LOCATION_SUGGESTION_GROUPS: { label: string; items: string[] }[] = [
  { label: 'Remote / nationwide', items: ['Remote, US', 'United States'] },
  { label: 'Major US markets', items: ['New York, NY', 'San Francisco Bay Area', 'Seattle, WA', 'Austin, TX', 'Chicago, IL', 'Washington, DC'] },
];
const SKILL_SUGGESTIONS = [
  'React', 'TypeScript', 'JavaScript', 'Node.js', 'Next.js', 'Python', 'SQL', 'AWS', 'GraphQL', 'Docker',
];

type SettingsCategory = 'search' | 'automation' | 'ai' | 'integrations' | 'advanced';

const SETTINGS_CATEGORIES: {
  id: SettingsCategory;
  title: string;
  short: string;
  description: string;
}[] = [
  {
    id: 'search',
    title: 'Job Search',
    short: 'Roles, sources & filters',
    description: 'Choose what to search, where to search, how many jobs to fetch, and which jobs are worth an AI score.',
  },
  {
    id: 'automation',
    title: 'Automation',
    short: 'Daily runs & tailoring',
    description: 'Control unattended job discovery and the overnight résumé-tailoring queue.',
  },
  {
    id: 'ai',
    title: 'AI & Models',
    short: 'Subscriptions & task models',
    description: 'Connect Claude or ChatGPT and choose which provider handles chat, tailoring, and scoring.',
  },
  {
    id: 'integrations',
    title: 'Connections & Keys',
    short: 'API keys & Gmail',
    description: 'Manage private provider credentials, key rotation, and the read-only Gmail inbox connection.',
  },
  {
    id: 'advanced',
    title: 'Advanced',
    short: 'Safety & infrastructure',
    description: 'Access destructive score controls and legacy worker configuration. Most users can leave these unchanged.',
  },
];

export default function SettingsPage() {
  const [s, setS] = useState<Settings | null>(null);
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>('search');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // New worker secret to set (write-only). Empty = leave the saved one unchanged;
  // s.resume_worker_secret holds only a masked preview from the GET.
  const [workerSecret, setWorkerSecret] = useState('');

  useEffect(() => {
    const fromHash = window.location.hash.replace(/^#/, '') as SettingsCategory;
    if (SETTINGS_CATEGORIES.some((category) => category.id === fromHash)) setActiveCategory(fromHash);
    fetch('/api/settings')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setS(d))
      .catch(() => {});
  }, []);

  function patch(p: Partial<Settings>) {
    setS((prev) => (prev ? { ...prev, ...p } : prev));
  }

  function selectCategory(category: SettingsCategory) {
    setActiveCategory(category);
    window.history.replaceState({}, '', `${window.location.pathname}${window.location.search}#${category}`);
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  // Auto-rotate is persisted immediately (like the per-key active toggle), not via
  // the Save button — the PUT handler updates only the fields it's given.
  async function setAutoRotate(v: boolean) {
    patch({ auto_rotate_keys: v });
    await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ auto_rotate_keys: v }),
    });
  }

  async function enableClaudeTailoring() {
    patch({ tailor_provider: 'subscription', tailor_model: 'sonnet' });
    const response = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tailor_provider: 'subscription', tailor_model: 'sonnet' }),
    });
    if (!response.ok) throw new Error('Claude connected, but the tailoring selection could not be saved.');
  }

  async function enableChatGPTTailoring() {
    patch({ tailor_provider: 'chatgpt_subscription', tailor_model: 'gpt-5.6-terra' });
    const response = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tailor_provider: 'chatgpt_subscription', tailor_model: 'gpt-5.6-terra' }),
    });
    if (!response.ok) throw new Error('ChatGPT connected, but the tailoring selection could not be saved.');
  }

  async function save() {
    if (!s) return;
    setSaving(true);
    setSaveError(null);
    try {
      // Only send a new worker secret when one was typed; otherwise the masked value
      // in `s` is sent and the server ignores it (so the saved secret is preserved).
      const newSecret = workerSecret.trim();
      const body = newSecret ? { ...s, resume_worker_secret: newSecret } : s;
      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || `Could not save settings (${response.status})`);
      }
      // Reflect the newly-set secret as a masked preview and clear the input.
      if (newSecret) {
        patch({ resume_worker_secret: `••••••${newSecret.slice(-4)}` });
        setWorkerSecret('');
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  if (!s) {
    return (
      <div className="p-4 sm:p-6 lg:p-7">
        <div className="h-8 w-40 bg-raised rounded animate-pulse mb-6" />
        <div className="h-40 bg-card border border-ink rounded-xl animate-pulse" />
      </div>
    );
  }

  const category = SETTINGS_CATEGORIES.find((item) => item.id === activeCategory) ?? SETTINGS_CATEGORIES[0];

  return (
    <div className="max-w-6xl p-4 sm:p-6 lg:p-8 animate-slide-up">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="page-title text-2xl">Settings</h1>
          <p className="page-sub">Choose a category to find and understand the setting you need.</p>
        </div>
        {saved && (
          <div className="flex items-center gap-1.5 rounded-lg border border-emerald/25 bg-emerald/10 px-3 py-1.5 text-[13px] text-emerald animate-fade-in">
            <CheckCircle size={14} /> Saved
          </div>
        )}
      </div>

      {saveError && (
        <div className="mb-5 flex items-start gap-2 rounded-lg border border-rose/30 bg-rose/10 px-3.5 py-3 text-[12px] text-rose">
          <AlertCircle size={15} className="mt-0.5 shrink-0" />
          <span>{saveError}</span>
        </div>
      )}

      <nav aria-label="Settings categories" className="mb-7">
        <div className="sm:hidden">
          <label htmlFor="settings-category" className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-slate-muted">Settings category</label>
          <select
            id="settings-category"
            value={activeCategory}
            onChange={(event) => selectCategory(event.target.value as SettingsCategory)}
            className="w-full rounded-lg border border-ink bg-card px-3 py-2.5 text-[13px] text-slate-text outline-none focus:border-sky/50 focus:ring-1 focus:ring-sky/25"
          >
            {SETTINGS_CATEGORIES.map((item) => <option key={item.id} value={item.id}>{item.title} — {item.short}</option>)}
          </select>
        </div>
        <div className="hidden gap-2 sm:grid sm:grid-cols-2 lg:grid-cols-5">
          {SETTINGS_CATEGORIES.map((item) => {
            const selected = item.id === activeCategory;
            return (
              <button
                key={item.id}
                type="button"
                aria-current={selected ? 'page' : undefined}
                onClick={() => selectCategory(item.id)}
                className={`min-w-[190px] rounded-xl border p-3 text-left transition-all sm:min-w-0 ${
                  selected
                    ? 'border-sky/40 bg-sky/10 shadow-[0_0_0_1px_rgba(56,189,248,0.08)]'
                    : 'border-ink bg-card hover:border-sky/25 hover:bg-raised'
                }`}
              >
                <span className={`mb-2 flex h-8 w-8 items-center justify-center rounded-lg ${selected ? 'bg-sky/15 text-sky' : 'bg-raised text-slate-muted'}`}>
                  <SettingsCategoryIcon category={item.id} />
                </span>
                <span className={`block text-[13px] font-medium ${selected ? 'text-sky' : 'text-slate-text'}`}>{item.title}</span>
                <span className="mt-0.5 block text-[10px] leading-relaxed text-slate-muted">{item.short}</span>
              </button>
            );
          })}
        </div>
      </nav>

      <div className="max-w-4xl">
        <div className="mb-5">
          <p className="font-display text-lg font-semibold text-slate-text">{category.title}</p>
          <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-slate-muted">{category.description}</p>
          <p className="mt-2 text-[11px] text-slate-dim">
            {activeCategory === 'integrations' ? (
              <>API-key, rotation, and Gmail actions in this category save immediately.</>
            ) : (
              <>Changes in this category take effect after <span className="text-slate-muted">Save settings</span>. Subscription connection actions save immediately.</>
            )}
          </p>
        </div>

      {/* Schedule */}
      {activeCategory === 'automation' && (
      <Section title="Daily Schedule">
        <p className="mb-4 text-[12px] leading-relaxed text-slate-muted">
          Automated discovery is launched by the deployment&apos;s Netlify schedule. The switch below decides whether this account participates when that schedule runs.
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-[11px] text-slate-muted mb-1.5 font-medium uppercase tracking-wider">Your timezone</label>
            <select
              value={s.timezone || 'America/New_York'}
              onChange={(e) => patch({ timezone: e.target.value })}
              className="w-full bg-base/80 border border-ink focus:border-sky/50 focus:ring-1 focus:ring-sky/25 outline-none transition-colors px-3 py-2 rounded-lg text-[13px] text-slate-text"
            >
              {TIMEZONE_OPTIONS.map((tz) => (
                <option key={tz.value} value={tz.value}>{tz.label}</option>
              ))}
              {/* Preserve a saved value that isn't one of the presets (e.g. a custom IANA tz). */}
              {s.timezone && !TIMEZONE_OPTIONS.some((tz) => tz.value === s.timezone) && (
                <option value={s.timezone}>{s.timezone}</option>
              )}
            </select>
            <p className="mt-1.5 text-[11px] leading-relaxed text-slate-muted">Used to interpret the overnight tailoring time and display account-local dates. It does not change Netlify&apos;s deployment timer.</p>
          </div>
        </div>
        <div className="mt-5 flex items-center gap-2">
          <input
            type="checkbox"
            id="auto_scrape_enabled"
            checked={s.auto_scrape_enabled ?? true}
            onChange={(e) => patch({ auto_scrape_enabled: e.target.checked })}
            className="w-4 h-4 rounded accent-sky"
          />
          <label htmlFor="auto_scrape_enabled" className="text-[13px] text-slate-text">Enable automated daily runs</label>
        </div>
        <p className="text-slate-muted text-[11px] mt-3">
          When enabled, the scheduled run fetches jobs for this account using the saved Job Search settings. Turning it off pauses scheduled discovery without affecting the manual <span className="text-sky">Run now</span> button.
        </p>

        <div className="mt-6 pt-5 border-t border-ink">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="auto_tailor_enabled"
              checked={s.auto_tailor_enabled ?? false}
              onChange={(e) => patch({ auto_tailor_enabled: e.target.checked })}
              className="w-4 h-4 rounded accent-sky"
            />
            <label htmlFor="auto_tailor_enabled" className="text-[13px] text-slate-text">
              Auto-tailor the Tailor &amp; Apply queue overnight
            </label>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="Tailor time (HH:MM)"
              value={s.auto_tailor_time ?? '04:00'}
              onChange={(v) => patch({ auto_tailor_time: v })}
              placeholder="04:00"
              hint="Local time, interpreted using Your timezone above. The worker checks hourly, so use a whole-hour value such as 04:00."
            />
          </div>
          <p className="text-slate-muted text-[11px] mt-3">
            At this time (in the timezone above), every résumé you&apos;ve queued in{' '}
            <span className="text-sky">Tailor &amp; Apply</span> is tailored and rendered to a PDF on the worker — so
            the heavy AI usage is spent overnight and the résumés are ready by morning. Runs one at a time; failed rows are
            marked and skipped. Leave off to tailor manually with “Generate selected”.
          </p>
          <p className="text-slate-muted text-[11px] mt-2">
            The schedule is driven by the always-on worker Mac (the app host doesn&apos;t run timers), so the worker must be
            online and awake at this hour. Use <span className="text-sky">Run queue now</span> on Tailor &amp; Apply to test it
            any time.
          </p>
        </div>
      </Section>
      )}

      {/* Search */}
      {activeCategory === 'search' && (
      <Section title="Search Criteria">
        <p className="text-slate-muted text-[12px] mb-4">
          Build a library of roles and locations once — they stay here. Each run searches only the ones you
          <span className="text-sky"> select</span> (highlighted). Click to toggle; the × removes one from the library.
        </p>

        <LibraryPicker
          label="Roles / keywords"
          options={s.keyword_options ?? []}
          selected={s.keywords}
          suggestions={KEYWORD_SUGGESTIONS}
          placeholder="Add a role…"
          onToggle={(v) => patch({ keywords: s.keywords.includes(v) ? s.keywords.filter((x) => x !== v) : [...s.keywords, v] })}
          onAdd={(v) =>
            patch({
              keyword_options: (s.keyword_options ?? []).includes(v) ? s.keyword_options : [...(s.keyword_options ?? []), v],
              keywords: s.keywords.includes(v) ? s.keywords : [...s.keywords, v],
            })
          }
          onRemove={(v) =>
            patch({
              keyword_options: (s.keyword_options ?? []).filter((x) => x !== v),
              keywords: s.keywords.filter((x) => x !== v),
            })
          }
        />

        <LibraryPicker
          label="Locations"
          options={s.location_options ?? []}
          selected={s.locations}
          suggestionGroups={LOCATION_SUGGESTION_GROUPS}
          placeholder="Add a location…"
          onToggle={(v) => patch({ locations: s.locations.includes(v) ? s.locations.filter((x) => x !== v) : [...s.locations, v] })}
          onAdd={(v) =>
            patch({
              location_options: (s.location_options ?? []).includes(v) ? s.location_options : [...(s.location_options ?? []), v],
              locations: s.locations.includes(v) ? s.locations : [...s.locations, v],
            })
          }
          onRemove={(v) => {
            const nextLimits = { ...(s.location_limits ?? {}) };
            delete nextLimits[v];
            patch({
              location_options: (s.location_options ?? []).filter((x) => x !== v),
              locations: s.locations.filter((x) => x !== v),
              location_limits: nextLimits,
            });
          }}
        />

        <SkillsEditor skills={s.skills ?? []} onChange={(v) => patch({ skills: v })} />

        {(s.skills ?? []).length > 0 && (
          <div className="mb-4 flex items-start gap-3 bg-raised border border-ink rounded-lg px-3.5 py-3">
            <div className="shrink-0">
              <input
                type="number"
                min={0}
                max={100}
                value={s.min_skill_match ?? 0}
                onChange={(e) => patch({ min_skill_match: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
                className="w-20 bg-base/80 border border-ink focus:border-sky/50 focus:ring-1 focus:ring-sky/25 outline-none transition-colors px-3 py-1.5 rounded-lg text-[13px] text-slate-text font-mono"
              />
            </div>
            <div>
              <p className="text-[13px] font-medium text-slate-text">Skip jobs below this skill match (%)</p>
              <p className="text-[11px] text-slate-muted mt-0.5">
                Daily runs <span className="text-emerald">won&apos;t spend an AI score</span> on jobs under this skill match — they&apos;re
                marked Filtered. <b>0</b> = off · <b>1</b> = require at least one of your skills · with 3 skills, one match ≈ 33%.
              </p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-2">
          <Field label="Job age lookback" value={String(s.hours_old)} onChange={(v) => patch({ hours_old: Number(v) || 24 })} hint="How many hours back each source should search. 24 means jobs posted in roughly the last day." />
          <Field label="Results per role" value={String(s.results_per_query)} onChange={(v) => patch({ results_per_query: Number(v) || 50 })} hint="Requested result count for each selected role. Sources may return fewer." />
          <Field
            label="Total run cap"
            value={String(s.max_jobs_per_run ?? 0)}
            onChange={(v) => patch({ max_jobs_per_run: Math.max(0, Number(v) || 0) })}
            placeholder="0"
            hint="Hard ceiling across the run. Use 0 for no app-level cap; provider billing limits still apply."
          />
        </div>

        {/* Fetch strategy (ADR 0023) */}
        <div className="mt-4">
          <p className="text-[11px] text-slate-muted mb-1.5 font-medium uppercase tracking-wider">Fetch mode</p>
          <select
            value={s.fetch_mode ?? 'url'}
            onChange={(e) => patch({ fetch_mode: e.target.value as 'url' | 'keyword' })}
            className="w-full sm:w-auto bg-base/80 border border-ink focus:border-sky/50 focus:ring-1 focus:ring-sky/25 outline-none transition-colors px-3 py-2 rounded-lg text-[13px] text-slate-text"
          >
            <option value="url">Precise — search exactly your role × location combos</option>
            <option value="keyword">Broad — let the scraper expand your keywords × locations</option>
          </select>
          <p className="text-slate-muted text-[11px] mt-2">
            <span className="text-sky">Precise</span> crawls one search per role×location you selected — predictable count.{' '}
            <span className="text-sky">Broad</span> hands your keywords + locations to the scraper to cast a wider net (may surface
            more, less predictable). Both de-duplicate and obey <span className="font-mono">Max jobs / run</span> (min 150).
          </p>
        </div>
      </Section>
      )}

      {/* AI Models — three independent lanes (ADR 0025/0069) */}
      {activeCategory === 'ai' && (
      <>
      <div className="mb-5 flex flex-col gap-3 rounded-xl border border-sky/20 bg-sky/5 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[13px] font-medium text-slate-text">Looking for prompts or candidate answers?</p>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-muted">Résumé facts, sponsorship and clearance answers, job-avoidance preferences, and scoring/tailoring guidance live in Candidate Profile so there is only one source of truth.</p>
        </div>
        <a href="/profile" className="inline-flex shrink-0 items-center gap-1.5 text-[12px] font-medium text-sky hover:underline">
          Open Candidate Profile <ArrowRight size={13} />
        </a>
      </div>
      <ClaudeConnectionSection onConnected={enableClaudeTailoring} />
      <ChatGPTConnectionSection onConnected={enableChatGPTTailoring} />

      <Section title="AI Models">
        <p className="text-slate-muted text-[12px] mb-4">
          Choose a provider and model independently for <span className="text-sky">AI Chat</span>,{' '}
          <span className="text-sky">Tailoring</span>, and <span className="text-sky">Everything else</span>. Direct API providers
          use that provider&apos;s <span className="text-emerald">active key</span> under Connections &amp; Keys; subscription providers use the worker login
          and never silently fall back to a paid key.
        </p>
        <p className="text-slate-muted text-[12px] mb-4">
          <span className="text-emerald">Claude subscription</span> uses your private connection above;{' '}
          <span className="text-emerald">ChatGPT subscription</span> uses the Codex SDK login. Both require the{' '}
          <span className="font-mono">worker</span> to be online. Plan limits still
          apply. Scoring is high volume, so choose the smaller model when you route Everything else through a subscription.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <TaskModel
            title="AI Chat"
            hint="ApplyBuddy application answers & recruiter replies"
            provider={s.chat_provider ?? s.score_provider ?? 'openai'}
            model={s.chat_model ?? s.score_model ?? 'gpt-4o-mini'}
            onProvider={(prov) => patch({ chat_provider: prov, chat_model: defaultModel(prov) })}
            onModel={(v) => patch({ chat_model: v })}
          />
          <TaskModel
            title="Tailoring"
            hint="Résumé structuring, tailoring, condensing & cover letters"
            provider={s.tailor_provider ?? 'anthropic'}
            model={s.tailor_model ?? 'claude-sonnet-4-6'}
            onProvider={(prov) => patch({ tailor_provider: prov, tailor_model: defaultModel(prov) })}
            onModel={(v) => patch({ tailor_model: v })}
          />
          <TaskModel
            title="Everything else"
            hint="High-volume job scoring & inbox classification"
            provider={s.score_provider ?? 'openai'}
            model={s.score_model ?? 'gpt-4o-mini'}
            onProvider={(prov) => patch({ score_provider: prov, score_model: defaultModel(prov) })}
            onModel={(v) => patch({ score_model: v })}
          />
        </div>
      </Section>
      </>
      )}

      {/* Pre-scoring filter */}
      {activeCategory === 'search' && (
      <Section title="Pre-scoring Filter">
        <p className="text-slate-muted text-[12px] mb-4">
          Before spending an LLM call on each job, a local <span className="text-slate-text">ATS-style match</span> rates your
          résumé against the posting the way an applicant tracking system would — skills the job asks for (must-haves and
          title mentions weigh more), job-title alignment, and remaining keyword coverage, with penalties for
          large experience or advanced-degree gaps. Candidate-specific sponsorship and clearance choices are handled later by AI scoring. Jobs below the threshold are marked{' '}
          <span className="text-amber-400">Filtered</span> and skipped, saving tokens. Turn it off to score every job.
        </p>
        <div className="flex items-start gap-3 bg-raised border border-ink rounded-lg px-3.5 py-3 mb-4">
          <button
            role="switch"
            aria-checked={s.prefilter_enabled ?? false}
            onClick={() => patch({ prefilter_enabled: !(s.prefilter_enabled ?? false) })}
            className={`mt-0.5 shrink-0 w-9 h-5 rounded-full transition-colors relative ${s.prefilter_enabled ? 'bg-emerald/80' : 'bg-ink'}`}
          >
            <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${s.prefilter_enabled ? 'left-[18px]' : 'left-0.5'}`} />
          </button>
          <div>
            <p className="text-[13px] font-medium text-slate-text">Filter jobs before LLM scoring</p>
            <p className="text-[11px] text-slate-muted mt-0.5">Only jobs at or above the match threshold get an LLM score.</p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <p className="text-[11px] text-slate-muted mb-1.5 font-medium uppercase tracking-wider">Match threshold (%)</p>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={s.prefilter_threshold ?? 30}
                onChange={(e) => patch({ prefilter_threshold: Number(e.target.value) })}
                disabled={!s.prefilter_enabled}
                className="flex-1 accent-sky disabled:opacity-40"
              />
              <span className="w-12 text-right text-[13px] text-slate-text font-mono">{s.prefilter_threshold ?? 30}%</span>
            </div>
          </div>
        </div>
        <p className="text-slate-muted text-[11px] mt-3">
          The match % is computed when jobs are fetched and shown on each job, so you can tune the threshold against real
          numbers — “Recompute ATS match” on the Jobs tab refreshes it after résumé or skills edits. Filtered jobs stay
          visible under the <span className="text-amber-400">Filtered</span> tab on the Jobs page.
        </p>
      </Section>
      )}

      {/* Company assessment now rides the scoring call itself (ADR 0065) — every scored
          job gets a company tier + tech stack in the same pass, so there's no separate
          auto-assess toggle or on-demand button to configure here. */}

      {/* Delete-scores danger gate (ADR 0048) */}
      {activeCategory === 'advanced' && (
      <Section title="Delete scores">
        <p className="text-slate-muted text-[12px] mb-4">
          When on, the <span className="text-sky">Jobs</span> tab shows extra bulk actions on selected jobs to
          <span className="text-rose"> delete</span> a job&apos;s AI fit score, company score, match score, or its tailored
          résumé. This is destructive, so it&apos;s <span className="text-amber-400">off by default</span> — turn it on only when
          you deliberately want to clear scores, then turn it back off. Deleting the fit score returns a job to
          <span className="text-slate-text"> unscored</span>, so it can be freshly scored again.
        </p>
        <div className="flex items-start gap-3 bg-raised border border-ink rounded-lg px-3.5 py-3">
          <button
            role="switch"
            aria-checked={s.allow_delete_scores ?? false}
            onClick={() => patch({ allow_delete_scores: !(s.allow_delete_scores ?? false) })}
            className={`mt-0.5 shrink-0 w-9 h-5 rounded-full transition-colors relative ${s.allow_delete_scores ? 'bg-rose/80' : 'bg-ink'}`}
          >
            <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${s.allow_delete_scores ? 'left-[18px]' : 'left-0.5'}`} />
          </button>
          <div>
            <p className="text-[13px] font-medium text-slate-text">Allow deleting scores</p>
            <p className="text-[11px] text-slate-muted mt-0.5">
              When on, selecting jobs on the Jobs tab reveals <span className="text-slate-text">Delete fit / company / match /
              tailored</span> actions. <span className="text-amber-400">Save settings</span> to apply, then delete from the Jobs
              tab — and switch this back off when you&apos;re done.
            </p>
          </div>
        </div>
      </Section>
      )}

      {/* API Keys vault */}
      {activeCategory === 'integrations' && (
      <>
      <ApiKeysSection autoRotate={s.auto_rotate_keys ?? false} onAutoRotate={setAutoRotate} />

      {/* Gmail inbox connection */}
      <GmailSection />
      </>
      )}

      {/* Portals */}
      {activeCategory === 'search' && (
      <Section title="Job Portals">
        <p className="text-slate-muted text-[12px] mb-4">
          Select which job boards to search. Each uses a separate Apify actor and runs in parallel.
        </p>
        <div className="flex flex-col gap-3 mb-5">
          {[
            { key: 'linkedin',     label: 'LinkedIn',     actor: 'Pay-per-result actor (configurable below)' },
            { key: 'indeed',       label: 'Indeed',       actor: 'misceres~indeed-scraper' },
            { key: 'glassdoor',    label: 'Glassdoor',    actor: 'bebity~glassdoor-jobs-scraper' },
            { key: 'career_sites', label: 'Career sites', actor: 'fantastic-jobs~career-site-job-listing-api · ⚠ $12 / 1k jobs on the free tier' },
          ].map(({ key, label, actor }) => {
            const portals = s.job_portals ?? ['linkedin'];
            const checked = portals.includes(key);
            return (
              <label key={key} className="group flex cursor-pointer items-start gap-3 sm:items-center">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...portals, key]
                      : portals.filter((p) => p !== key);
                    patch({ job_portals: next.length ? next : ['linkedin'] });
                  }}
                  className="w-4 h-4 rounded accent-sky"
                />
                <span className="w-24 shrink-0 text-[13px] font-medium text-slate-text">{label}</span>
                <span className="break-words font-mono text-[11px] text-slate-muted">{actor}</span>
              </label>
            );
          })}
        </div>

        {/* LinkedIn actor variant — only shown when LinkedIn is selected */}
        {(s.job_portals ?? ['linkedin']).includes('linkedin') && (
          <div className="pt-4 border-t border-ink">
            <p className="text-[11px] text-slate-muted mb-3 font-medium uppercase tracking-wider">LinkedIn Actor Variant</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <select
                  value={ACTORS.find((a) => a.id === s.apify_actor_id) ? s.apify_actor_id : 'custom'}
                  onChange={(e) => { if (e.target.value !== 'custom') patch({ apify_actor_id: e.target.value }); }}
                  className="w-full bg-base/80 border border-ink focus:border-sky/50 focus:ring-1 focus:ring-sky/25 outline-none transition-colors px-3 py-2 rounded-lg text-[13px] text-slate-text"
                >
                  {ACTORS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                  <option value="custom">Custom...</option>
                </select>
              </div>
              <Field
                label="Actor ID"
                value={s.apify_actor_id}
                onChange={(v) => patch({ apify_actor_id: v.replace(/\//g, '~') })}
                placeholder="cheap_scraper~linkedin-job-scraper"
                hint="Apify actor identifier. Keep the recommended actor unless you have verified another actor's input and pricing."
              />
            </div>

            {/* Experience-level facet (ADR 0058) — baked into the search URL (f_E),
                so filtered-out jobs are never fetched or billed. */}
            <p className="text-[11px] text-slate-muted mt-4 mb-2 font-medium uppercase tracking-wider">Experience Levels</p>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {EXPERIENCE_LEVELS.map(({ value, label }) => {
                const levels = s.linkedin_experience_levels ?? [];
                const checked = levels.includes(value);
                return (
                  <label key={value} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => patch({
                        linkedin_experience_levels: e.target.checked
                          ? [...levels, value]
                          : levels.filter((l) => l !== value),
                      })}
                      className="w-4 h-4 rounded accent-sky"
                    />
                    <span className="text-[12px] text-slate-text">{label}</span>
                  </label>
                );
              })}
            </div>
            <p className="text-[11px] text-slate-muted mt-1.5">
              Filters inside LinkedIn&apos;s search, <span className="text-slate-text">before</span> the pay-per-result actor
              bills anything. None checked = no filter.
            </p>
          </div>
        )}

        {/* Career-sites cap — only shown when the portal is opted in */}
        {(s.job_portals ?? ['linkedin']).includes('career_sites') && (
          <div className="pt-4 border-t border-ink">
            <p className="text-[11px] text-slate-muted mb-3 font-medium uppercase tracking-wider">Career Sites (ATS-direct)</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field
                label="Max jobs / run (spend dial)"
                value={String(s.career_sites_max_jobs ?? 150)}
                onChange={(v) => patch({ career_sites_max_jobs: Math.max(10, Math.min(5000, Number(v) || 150)) })}
                placeholder="150"
                hint="Maximum career-site results purchased in one run. Lower values reduce Apify spend."
              />
            </div>
            <p className="text-[11px] text-amber-400 mt-2">
              This actor bills <span className="font-mono">$12 / 1,000 jobs</span> on the Apify free tier
              (150 jobs ≈ $1.80 per run) — the cap above is the only cost control. Sources: Greenhouse, Lever,
              Workday, Ashby &amp; 50+ ATS platforms, deduplicated and with direct application URLs.
            </p>
          </div>
        )}

        <p className="text-slate-muted text-[11px] mt-4">
          The Apify token comes from the active <span className="text-sky">Apify</span> key under Connections &amp; Keys.
          This managed multi-user deployment does not use another account&apos;s or a deployment-level fallback key. Indeed and Glassdoor actor IDs are
          defaults — verify on <span className="font-mono text-sky">console.apify.com</span> before first use.
        </p>
      </Section>
      )}

      {/* Legacy single-owner deployments can edit their tunnel. In the multi-user
          fork this trusted endpoint is deployment-managed and intentionally hidden. */}
      {activeCategory === 'advanced' && (
      <>
      {!s.worker_managed && <Section title="Résumé Worker">
        <p className="text-slate-muted text-[12px] mb-4">
          The URL and shared secret for your local Puppeteer worker (résumé tailoring + PDF rendering).
          What you set here takes precedence over the <span className="font-mono text-sky">RESUME_WORKER_URL</span> /
          <span className="font-mono text-sky"> RESUME_WORKER_SECRET</span> env vars, so you can change the tunnel URL
          without a redeploy. The secret must match the worker's <span className="font-mono text-sky">WORKER_SECRET</span>.
        </p>
        <div className="grid grid-cols-1 gap-4">
          <Field
            label="Worker URL"
            value={s.resume_worker_url ?? ''}
            onChange={(v) => patch({ resume_worker_url: v })}
            placeholder="https://mission-julia-direction-omissions.trycloudflare.com"
            hint="Legacy deployment only: the HTTPS endpoint used for long-running AI work and PDF rendering."
          />
          <div>
            <Field
              label="Worker secret"
              type="password"
              value={workerSecret}
              onChange={setWorkerSecret}
              placeholder={s.resume_worker_secret ? 'Saved — type a new value to replace it' : 'Set the shared worker secret'}
              hint="Must exactly match WORKER_SECRET on the résumé worker. Leave blank to keep the saved value."
            />
            <p className="text-slate-muted text-[11px] mt-1.5">
              {s.resume_worker_secret
                ? `A secret is saved (${s.resume_worker_secret}). Leave blank to keep it; enter a new value to replace it.`
                : 'No secret saved — the RESUME_WORKER_SECRET env var is used if set.'}
            </p>
          </div>
        </div>
      </Section>}
      {s.worker_managed && (
        <Section title="Managed Worker">
          <p className="text-[12px] leading-relaxed text-slate-muted">The résumé and subscription worker is managed by this deployment. Its URL and shared secret are intentionally hidden and cannot be changed by an account user.</p>
        </Section>
      )}
      </>
      )}

      <div className="sticky bottom-0 -mx-2 flex items-center gap-3 bg-void/85 px-2 py-3 backdrop-blur">
        <SaveBtn onClick={save} loading={saving} />
        {saved && (
          <span className="flex items-center gap-1.5 text-[13px] text-emerald animate-fade-in">
            <CheckCircle size={14} /> Saved
          </span>
        )}
      </div>
      </div>
    </div>
  );
}

type ClaudeConnectionState = {
  connected: boolean;
  authMethod?: string;
  subscriptionType?: string | null;
  email?: string | null;
  authorizationUrl?: string;
  expiresInSeconds?: number;
};

/**
 * Browser-facing broker for the official Claude Code subscription OAuth flow.
 * The user authenticates only on claude.com; ApplyPilot receives the one-time
 * callback code and the worker keeps the resulting login in that user's folder.
 */
function ClaudeConnectionSection({ onConnected }: { onConnected: () => Promise<void> }) {
  const [status, setStatus] = useState<ClaudeConnectionState | null>(null);
  const [authorizationUrl, setAuthorizationUrl] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function request(init?: RequestInit): Promise<ClaudeConnectionState> {
    const response = await fetch('/api/claude-connection', init);
    const data = (await response.json().catch(() => ({}))) as ClaudeConnectionState & { error?: string };
    if (!response.ok) throw new Error(data.error || `Claude connection failed (${response.status})`);
    return data;
  }

  async function reload() {
    try {
      setStatus(await request());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    reload();
  }, []);

  async function start() {
    setBusy(true);
    setError(null);
    const popup = window.open('about:blank', 'applypilot-claude-login');
    if (popup) popup.opener = null;
    try {
      const next = await request({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start' }),
      });
      if (next.connected) {
        popup?.close();
        setStatus(next);
        await onConnected();
        return;
      }
      const url = next.authorizationUrl || '';
      setAuthorizationUrl(url);
      if (popup && url) popup.location.href = url;
    } catch (e) {
      popup?.close();
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function complete() {
    setBusy(true);
    setError(null);
    try {
      const next = await request({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'complete', code }),
      });
      setStatus(next);
      await onConnected();
      setAuthorizationUrl('');
      setCode('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!window.confirm('Disconnect your Claude subscription from ApplyPilot?')) return;
    setBusy(true);
    setError(null);
    try {
      setStatus(await request({ method: 'DELETE' }));
      setAuthorizationUrl('');
      setCode('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Claude connection">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[13px] font-medium text-slate-text">Use your Claude subscription for résumé tailoring</p>
          <p className="text-[12px] text-slate-muted mt-1 max-w-xl">
            Sign in on Anthropic&apos;s website. ApplyPilot never sees your Claude password or browser cookies; the server
            stores only the resulting Claude Code login in your private user folder. Your plan limits and Anthropic terms apply.
          </p>
        </div>
        {status?.connected && (
          <span className="shrink-0 flex items-center gap-1.5 rounded-full border border-emerald/30 bg-emerald/10 px-2.5 py-1 text-[11px] text-emerald">
            <CheckCircle size={13} /> Connected
          </span>
        )}
      </div>

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-rose/30 bg-rose/10 px-3.5 py-3 text-[12px] text-rose">
          <AlertCircle size={15} className="mt-0.5 shrink-0" /> {error}
        </div>
      )}

      {status === null ? (
        <p className="mt-4 text-[12px] text-slate-muted">Checking connection…</p>
      ) : status.connected ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-ink bg-raised px-3.5 py-3">
          <div className="text-[12px] text-slate-muted">
            <span className="text-slate-text">{status.email || 'Claude account'}</span>
            {status.subscriptionType ? ` · ${status.subscriptionType}` : ''}
          </div>
          <button
            onClick={disconnect}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-lg border border-rose/30 px-2.5 py-1.5 text-[12px] text-rose hover:bg-rose/10 disabled:opacity-50"
          >
            <LogOut size={13} /> Disconnect
          </button>
        </div>
      ) : authorizationUrl ? (
        <div className="mt-4 rounded-lg border border-sky/25 bg-sky/5 p-4">
          <p className="text-[12px] text-slate-text font-medium">Finish connecting Claude</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-[12px] text-slate-muted">
            <li>Sign in and approve access in the Anthropic tab.</li>
            <li>Copy the one-time authorization code Anthropic shows.</li>
            <li>Paste it below within 10 minutes.</li>
          </ol>
          <a
            href={authorizationUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex items-center gap-1.5 text-[12px] text-sky hover:underline"
          >
            Reopen Anthropic authorization <ExternalLink size={13} />
          </a>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Paste the one-time code"
              autoComplete="off"
              className="min-w-0 flex-1 rounded-lg border border-ink bg-base/80 px-3 py-2 text-[13px] text-slate-text outline-none focus:border-sky/50"
            />
            <button
              onClick={complete}
              disabled={busy || !code.trim()}
              className="rounded-lg border border-sky/30 bg-sky/10 px-3 py-2 text-[12px] text-sky hover:bg-sky/20 disabled:opacity-50"
            >
              {busy ? 'Connecting…' : 'Complete connection'}
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={start}
          disabled={busy}
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-sky/30 bg-sky/10 px-3 py-2 text-[12px] text-sky hover:bg-sky/20 disabled:opacity-50"
        >
          <ExternalLink size={13} /> {busy ? 'Starting Claude login…' : 'Connect Claude subscription'}
        </button>
      )}

      <p className="mt-3 text-[11px] text-slate-muted">
        A successful connection automatically selects <span className="text-emerald">Claude subscription (no API key)</span> for Tailoring.
      </p>
    </Section>
  );
}

type ChatGPTConnectionState = {
  connected: boolean;
  pending?: boolean;
  authMethod?: string;
  authorizationUrl?: string;
  code?: string;
  expiresInSeconds?: number;
};

/** Official Codex device-code login, persisted in this ApplyPilot user's CODEX_HOME. */
function ChatGPTConnectionSection({ onConnected }: { onConnected: () => Promise<void> }) {
  const [status, setStatus] = useState<ChatGPTConnectionState | null>(null);
  const [device, setDevice] = useState<ChatGPTConnectionState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function request(init?: RequestInit): Promise<ChatGPTConnectionState> {
    const response = await fetch('/api/chatgpt-connection', init);
    const data = (await response.json().catch(() => ({}))) as ChatGPTConnectionState & { error?: string };
    if (!response.ok) throw new Error(data.error || `ChatGPT connection failed (${response.status})`);
    return data;
  }

  async function reload(activate = false) {
    try {
      const next = await request();
      setStatus(next);
      if (next.connected) {
        setDevice(null);
        if (activate) await onConnected();
      }
      return next;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      return null;
    }
  }

  useEffect(() => {
    reload();
  }, []);

  useEffect(() => {
    if (!device || status?.connected) return;
    const timer = window.setInterval(async () => {
      const next = await reload(true);
      if (next?.connected) window.clearInterval(timer);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [device, status?.connected]);

  async function start() {
    setBusy(true);
    setError(null);
    const popup = window.open('about:blank', 'applypilot-chatgpt-login');
    if (popup) popup.opener = null;
    try {
      const next = await request({ method: 'POST' });
      if (next.connected) {
        popup?.close();
        setStatus(next);
        await onConnected();
        return;
      }
      setDevice(next);
      if (popup && next.authorizationUrl) popup.location.href = next.authorizationUrl;
    } catch (reason) {
      popup?.close();
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!window.confirm('Disconnect your ChatGPT subscription from ApplyPilot?')) return;
    setBusy(true);
    setError(null);
    try {
      const next = await request({ method: 'DELETE' });
      setStatus(next);
      setDevice(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="ChatGPT connection">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[13px] font-medium text-slate-text">Use your ChatGPT subscription without an API key</p>
          <p className="text-[12px] text-slate-muted mt-1 max-w-xl">
            ApplyPilot starts OpenAI&apos;s official Codex device login. Your password stays on OpenAI&apos;s website; the server stores the resulting tokens only in this user&apos;s private folder. ChatGPT plan limits and workspace rules apply.
          </p>
        </div>
        {status?.connected && (
          <span className="shrink-0 flex items-center gap-1.5 rounded-full border border-emerald/30 bg-emerald/10 px-2.5 py-1 text-[11px] text-emerald">
            <CheckCircle size={13} /> Connected
          </span>
        )}
      </div>

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-rose/30 bg-rose/10 px-3.5 py-3 text-[12px] text-rose">
          <AlertCircle size={15} className="mt-0.5 shrink-0" /> {error}
        </div>
      )}

      {status === null ? (
        <p className="mt-4 text-[12px] text-slate-muted">Checking connection…</p>
      ) : status.connected ? (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-ink bg-raised px-3.5 py-3">
          <span className="text-[12px] text-slate-text">ChatGPT / Codex subscription connected</span>
          <button onClick={disconnect} disabled={busy} className="flex items-center gap-1.5 rounded-lg border border-rose/30 px-2.5 py-1.5 text-[12px] text-rose hover:bg-rose/10 disabled:opacity-50">
            <LogOut size={13} /> Disconnect
          </button>
        </div>
      ) : device?.authorizationUrl && device.code ? (
        <div className="mt-4 rounded-lg border border-sky/25 bg-sky/5 p-4">
          <p className="text-[12px] font-medium text-slate-text">Finish on OpenAI</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-[12px] text-slate-muted">
            <li>Open the official OpenAI device page below.</li>
            <li>Sign into the ChatGPT account whose subscription you want to use.</li>
            <li>Enter this one-time code: <span className="select-all font-mono text-base font-semibold tracking-wider text-sky">{device.code}</span></li>
          </ol>
          <a href={device.authorizationUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-[12px] text-sky hover:underline">
            Open OpenAI device login <ExternalLink size={13} />
          </a>
          <p className="mt-3 text-[11px] text-slate-muted">Only continue because you started this login here. This page checks automatically when OpenAI finishes.</p>
        </div>
      ) : (
        <button onClick={start} disabled={busy} className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-sky/30 bg-sky/10 px-3 py-2 text-[12px] text-sky hover:bg-sky/20 disabled:opacity-50">
          <ExternalLink size={13} /> {busy ? 'Starting ChatGPT login…' : 'Connect ChatGPT subscription'}
        </button>
      )}

      <p className="mt-3 text-[11px] text-slate-muted">A successful connection automatically selects ChatGPT subscription for Tailoring. You can also select it for AI Chat or Everything else below.</p>
    </Section>
  );
}

const KEY_PROVIDERS: { id: ApiKeyProvider; label: string; placeholder: string }[] = [
  { id: 'gemini', label: 'Google Gemini', placeholder: 'AIza…' },
  { id: 'openai', label: 'OpenAI', placeholder: 'sk-…' },
  { id: 'deepseek', label: 'DeepSeek', placeholder: 'sk-…' },
  { id: 'anthropic', label: 'Anthropic Claude', placeholder: 'sk-ant-…' },
  { id: 'apify', label: 'Apify', placeholder: 'apify_api_…' },
];

/**
 * API key vault (ADR 0006). Self-contained: manages its own state against
 * /api/keys, independent of the Settings blob since keys are their own table.
 * The browser only ever sees masked previews.
 */
function ApiKeysSection({ autoRotate, onAutoRotate }: { autoRotate: boolean; onAutoRotate: (v: boolean) => void }) {
  const [keys, setKeys] = useState<ApiKeyMasked[] | null>(null);

  async function reload() {
    try {
      const r = await fetch('/api/keys');
      if (r.ok) setKeys(await r.json());
    } catch {
      /* leave previous state */
    }
  }
  useEffect(() => {
    reload();
  }, []);

  // Create one or more keys for a provider. Sequential so auto-activation is
  // deterministic: the first created key becomes active when the provider had none.
  async function addMany(provider: ApiKeyProvider, entries: { label: string; value: string }[]) {
    for (const e of entries) {
      if (!e.value.trim()) continue;
      await fetch('/api/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, label: e.label.trim(), value: e.value.trim() }),
      });
    }
    await reload();
  }
  async function activate(id: string) {
    const r = await fetch(`/api/keys/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'activate' }),
    });
    if (r.ok) await reload();
  }
  async function remove(id: string) {
    const r = await fetch(`/api/keys/${id}`, { method: 'DELETE' });
    if (r.ok) await reload();
  }

  return (
    <Section title="API Keys">
      <p className="text-slate-muted text-[12px] mb-4">
        Store one or more keys per provider (e.g. several Apify accounts) and pick which one is{' '}
        <span className="text-emerald">active</span>. Apify keys fetch jobs; AI-provider keys are used only when that
        provider is selected under AI &amp; Models. This managed multi-user deployment has no shared key fallback.
        Keys are shown masked — delete and re-add a key to replace its value.
      </p>

      {/* Auto-rotate toggle (ADR 0007) */}
      <div className="flex items-start gap-3 bg-raised border border-ink rounded-lg px-3.5 py-3 mb-5">
        <button
          role="switch"
          aria-checked={autoRotate}
          onClick={() => onAutoRotate(!autoRotate)}
          className={`mt-0.5 shrink-0 w-9 h-5 rounded-full transition-colors relative ${autoRotate ? 'bg-emerald/80' : 'bg-ink'}`}
        >
          <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${autoRotate ? 'left-[18px]' : 'left-0.5'}`} />
        </button>
        <div>
          <p className="text-[13px] font-medium text-slate-text">Auto-rotate keys each run</p>
          <p className="text-[11px] text-slate-muted mt-0.5">
            When on, every run advances each provider that has 2+ keys to its next stored key (round-robin), spreading usage
            across accounts. The active badge always shows the current key.
          </p>
        </div>
      </div>

      <div className="flex flex-col divide-y divide-ink">
        {KEY_PROVIDERS.map((p) => (
          <ProviderKeys
            key={p.id}
            meta={p}
            keys={(keys ?? []).filter((k) => k.provider === p.id)}
            loading={keys === null}
            onAddMany={addMany}
            onActivate={activate}
            onRemove={remove}
          />
        ))}
      </div>
    </Section>
  );
}

function ProviderKeys({
  meta,
  keys,
  loading,
  onAddMany,
  onActivate,
  onRemove,
}: {
  meta: { id: ApiKeyProvider; label: string; placeholder: string };
  keys: ApiKeyMasked[];
  loading: boolean;
  onAddMany: (provider: ApiKeyProvider, entries: { label: string; value: string }[]) => Promise<void>;
  onActivate: (id: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="py-4 first:pt-0 last:pb-0">
      <div className="flex items-center justify-between mb-2.5">
        <p className="text-[13px] font-medium text-slate-text">
          {meta.label}
          {keys.length > 0 && (
            <span className="ml-2 text-[11px] text-slate-muted font-normal">
              {keys.length} key{keys.length > 1 ? 's' : ''}
            </span>
          )}
        </p>
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-1.5 px-2.5 py-1 text-[12px] text-sky border border-sky/30 bg-sky/10 hover:bg-sky/20 rounded-lg transition-all"
        >
          <Plus size={13} /> Add {meta.label} key
        </button>
      </div>

      {keys.length > 0 ? (
        <div className="flex flex-col gap-2">
          {keys.map((k) => (
            <div key={k.id} className="flex items-center gap-3 bg-raised border border-ink rounded-lg px-3 py-2">
              <button
                onClick={() => !k.is_active && onActivate(k.id)}
                title={k.is_active ? 'Active key' : 'Set as active'}
                className={
                  k.is_active
                    ? 'shrink-0 px-2 py-0.5 rounded-md text-[11px] font-medium bg-emerald/15 text-emerald border border-emerald/30'
                    : 'shrink-0 px-2 py-0.5 rounded-md text-[11px] text-slate-muted border border-ink hover:border-sky/40 hover:text-sky transition-colors'
                }
              >
                {k.is_active ? 'Active' : 'Set active'}
              </button>
              <span className="text-[13px] text-slate-text truncate">{k.label || <span className="text-slate-muted italic">unlabeled</span>}</span>
              {/* Low-credit park (ADR 0059): skipped by rotation until the account's monthly reset. */}
              {k.cooldown_until && new Date(k.cooldown_until) > new Date() && (
                <span
                  title="Credit too low for a full fetch — rotation skips this key until the account's monthly usage cycle resets"
                  className="shrink-0 px-2 py-0.5 rounded-md text-[11px] bg-amber-400/10 text-amber-400 border border-amber-400/30"
                >
                  ⏸ low credit · resets {new Date(k.cooldown_until).toLocaleDateString()}
                </span>
              )}
              <span className="text-[12px] text-slate-muted font-mono ml-auto">{k.key_preview}</span>
              <button onClick={() => onRemove(k.id)} title="Delete key" className="shrink-0 text-slate-muted hover:text-rose transition-colors">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        !loading && <p className="text-[12px] text-slate-muted">No keys stored for this account.</p>
      )}

      {open && (
        <AddKeyModal
          meta={meta}
          onClose={() => setOpen(false)}
          onSave={async (entries) => {
            await onAddMany(meta.id, entries);
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

/**
 * Modal to add one or many keys for a provider in a single pass. Rows can be
 * added/removed; on save, every non-empty row is created (the first becomes
 * active if the provider had no keys yet — switch active later from the list).
 */
function AddKeyModal({
  meta,
  onClose,
  onSave,
}: {
  meta: { id: ApiKeyProvider; label: string; placeholder: string };
  onClose: () => void;
  onSave: (entries: { label: string; value: string }[]) => Promise<void>;
}) {
  const [rows, setRows] = useState<{ label: string; value: string }[]>([{ label: '', value: '' }]);
  const [busy, setBusy] = useState(false);

  const filled = rows.filter((r) => r.value.trim());

  function update(i: number, field: 'label' | 'value', v: string) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, [field]: v } : r)));
  }
  function addRow() {
    setRows((rs) => [...rs, { label: '', value: '' }]);
  }
  function removeRow(i: number) {
    setRows((rs) => (rs.length > 1 ? rs.filter((_, idx) => idx !== i) : rs));
  }

  async function save() {
    if (filled.length === 0 || busy) return;
    setBusy(true);
    try {
      await onSave(filled);
    } finally {
      setBusy(false);
    }
  }

  // Close on Escape.
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg card shadow-pop p-5 animate-slide-up"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-display text-[15px] font-semibold text-slate-text">
            Add {meta.label} key{rows.length > 1 ? 's' : ''}
          </h3>
          <button onClick={onClose} className="text-slate-muted hover:text-slate-text transition-colors" title="Close">
            <X size={16} />
          </button>
        </div>
        <p className="text-[12px] text-slate-muted mb-4">
          Add one or more keys (e.g. several {meta.label} accounts). The first becomes <span className="text-emerald">active</span> if
          this provider has none yet; switch the active key anytime from the list.
        </p>

        <div className="flex flex-col gap-2 mb-3 max-h-[42vh] overflow-y-auto pr-0.5">
          {rows.map((r, i) => (
            <div key={i} className="flex gap-2">
              <input
                value={r.label}
                onChange={(e) => update(i, 'label', e.target.value)}
                placeholder="Label"
                className="w-32 bg-base/80 border border-ink focus:border-sky/50 focus:ring-1 focus:ring-sky/25 outline-none transition-colors px-3 py-1.5 rounded-lg text-[13px] text-slate-text placeholder:text-slate-muted"
              />
              <input
                value={r.value}
                onChange={(e) => update(i, 'value', e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && save()}
                placeholder={meta.placeholder}
                type="password"
                autoComplete="off"
                autoFocus={i === 0}
                className="flex-1 min-w-0 bg-base/80 border border-ink focus:border-sky/50 focus:ring-1 focus:ring-sky/25 outline-none transition-colors px-3 py-1.5 rounded-lg text-[13px] text-slate-text placeholder:text-slate-muted font-mono"
              />
              <button
                onClick={() => removeRow(i)}
                disabled={rows.length === 1}
                title="Remove row"
                className="shrink-0 text-slate-muted hover:text-rose disabled:opacity-30 disabled:hover:text-slate-muted transition-colors"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>

        <button onClick={addRow} className="flex items-center gap-1.5 text-[12px] text-sky hover:text-sky/80 mb-5 transition-colors">
          <Plus size={13} /> Add another
        </button>

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-[13px] text-slate-muted border border-ink hover:text-slate-text rounded-lg transition-colors">
            Cancel
          </button>
          <button
            onClick={save}
            disabled={filled.length === 0 || busy}
            className="flex items-center gap-2 px-4 py-2 bg-sky/10 text-sky border border-sky/30 hover:bg-sky/20 disabled:opacity-40 rounded-lg text-[13px] font-medium transition-all"
          >
            <Save size={14} /> {busy ? 'Saving…' : filled.length > 1 ? `Save ${filled.length} keys` : 'Save key'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Gmail connection (ADR 0012). The Google OAuth app credentials are entered here
 * (vault-style); "Connect Gmail" runs the OAuth flow. Read-only Gmail access.
 */
function GmailSection() {
  const [status, setStatus] = useState<GmailStatus | null>(null);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [redirectUri, setRedirectUri] = useState('');

  async function reload() {
    try {
      const r = await fetch('/api/gmail/creds');
      if (r.ok) setStatus(await r.json());
    } catch {
      /* ignore */
    }
  }
  useEffect(() => {
    setRedirectUri(`${window.location.origin}/api/gmail/callback`);
    reload();
    const code = new URLSearchParams(window.location.search).get('gmail');
    if (code) {
      const m: Record<string, string> = {
        connected: 'Gmail connected ✓',
        denied: 'Access was denied — try connecting again.',
        auth_failed: 'Could not verify the sign-in. Please try again.',
        missing_creds: 'Add your Client ID and Secret first.',
        error: 'Connection error — check your credentials and try again.',
      };
      setMsg(m[code] ?? null);
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  async function saveCreds() {
    if (busy || (!clientId.trim() && !clientSecret.trim())) return;
    setBusy(true);
    try {
      const r = await fetch('/api/gmail/creds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId.trim(), client_secret: clientSecret.trim() }),
      });
      setMsg(r.ok ? 'Credentials saved.' : 'Could not save credentials.');
      if (r.ok) {
        setClientId('');
        setClientSecret('');
        await reload();
      }
    } finally {
      setBusy(false);
    }
  }
  async function disconnect() {
    setBusy(true);
    try {
      await fetch('/api/gmail/disconnect', { method: 'POST' });
      setMsg('Disconnected.');
      await reload();
    } finally {
      setBusy(false);
    }
  }

  const hasCreds = status?.has_client_id && status?.has_client_secret;

  return (
    <Section title="Gmail Inbox (AI)">
      <p className="text-slate-muted text-[12px] mb-4">
        Connect Gmail to auto-classify incoming job mail (recruiter outreach · applied · shortlisted · action needed · assessment · rejection) and
        track a daily history. Read-only access. Results show under the <span className="text-sky">Inbox</span> tab.
      </p>

      {msg && <div className="mb-4 text-[12px] text-sky bg-sky/10 border border-sky/20 rounded-lg px-3 py-2">{msg}</div>}

      {status?.connected ? (
        <div className="flex items-center justify-between bg-raised border border-ink rounded-lg px-3.5 py-3">
          <div className="flex items-center gap-2.5">
            <CheckCircle size={16} className="text-emerald shrink-0" />
            <div>
              <p className="text-[13px] text-slate-text font-medium">Connected{status.email ? ` · ${status.email}` : ''}</p>
              <p className="text-[11px] text-slate-muted">
                {status.last_synced_at ? `Last synced ${new Date(status.last_synced_at).toLocaleString()}` : 'Not synced yet'}
              </p>
            </div>
          </div>
          <button onClick={disconnect} disabled={busy} className="text-[12px] text-slate-muted hover:text-rose border border-ink rounded-md px-3 py-1.5 transition-colors">
            Disconnect
          </button>
        </div>
      ) : (
        <>
          <div className="text-[11px] text-slate-muted mb-4 space-y-1.5">
            <p className="text-slate-text font-medium text-[12px]">One-time Google setup:</p>
            <p>1. In <span className="font-mono text-sky">console.cloud.google.com</span> create a project and enable the <span className="text-sky">Gmail API</span>.</p>
            <p>2. Configure the OAuth consent screen (External) and add yourself as a test user.</p>
            <p>3. Create an <span className="text-sky">OAuth client ID</span> (type: Web application) with this Authorized redirect URI:</p>
            <code className="block bg-base border border-ink rounded px-2 py-1.5 font-mono text-[11px] text-slate-text break-all">{redirectUri || '…'}</code>
            <p>4. Paste the Client ID and Secret below, save, then Connect.</p>
          </div>

          <div className="flex flex-col gap-2 mb-3">
            <Field
              label="Client ID"
              value={clientId}
              onChange={setClientId}
              placeholder={status?.has_client_id ? '•••• saved — paste to replace' : 'xxxx.apps.googleusercontent.com'}
            />
            <div>
              <p className="text-[11px] text-slate-muted mb-1.5 font-medium uppercase tracking-wider">Client Secret</p>
              <input
                type="password"
                autoComplete="off"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                placeholder={status?.has_client_secret ? '•••• saved — paste to replace' : 'GOCSPX-…'}
                className="w-full bg-base/80 border border-ink focus:border-sky/50 focus:ring-1 focus:ring-sky/25 outline-none transition-colors px-3 py-2 rounded-lg text-[13px] text-slate-text placeholder:text-slate-muted font-mono"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={saveCreds}
              disabled={busy}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-sky border border-sky/30 bg-sky/10 hover:bg-sky/20 disabled:opacity-40 rounded-lg transition-all"
            >
              <Save size={13} /> Save credentials
            </button>
            {hasCreds && (
              <a
                href="/api/gmail/auth"
                className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-emerald border border-emerald/30 bg-emerald/10 hover:bg-emerald/20 rounded-lg transition-all"
              >
                <Mail size={13} /> Connect Gmail
              </a>
            )}
          </div>
        </>
      )}
    </Section>
  );
}

/**
 * Skills the actor matches each job against (ADR 0018). Plain add/remove chips —
 * every skill listed is used. Each job then shows a 0–100 skill-match % + which of
 * these it matched, with no extra LLM cost.
 */
function SkillsEditor({ skills, onChange }: { skills: string[]; onChange: (v: string[]) => void }) {
  const [input, setInput] = useState('');
  function add(v: string) {
    const t = v.trim();
    if (t && !skills.includes(t)) onChange([...skills, t]);
    setInput('');
  }
  const fresh = SKILL_SUGGESTIONS.filter((s) => !skills.includes(s));

  return (
    <div className="mb-4">
      <p className="text-[11px] text-slate-muted mb-2 font-medium uppercase tracking-wider">Skills (skill-match scoring)</p>
      <p className="text-[11px] text-slate-muted mb-2">
        Each job gets a 0–100 <span className="text-sky">skill match</span> showing how many of these it mentions — free, no AI
        call. Doesn’t change what’s fetched.
      </p>
      <div className="flex flex-wrap gap-2 mb-2.5">
        {skills.length === 0 && <span className="text-[12px] text-slate-muted">No skills yet — add your primary ones below.</span>}
        {skills.map((sk) => (
          <span key={sk} className="group flex items-center rounded-md border border-emerald/30 bg-emerald/10 text-emerald text-[12px]">
            <span className="pl-2 pr-1.5 py-1">{sk}</span>
            <button onClick={() => onChange(skills.filter((x) => x !== sk))} title="Remove" className="pr-1.5 py-1 text-emerald/60 hover:text-rose transition-colors">
              <X size={12} />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add(input)}
          placeholder="Add a skill (e.g. React)…"
          className="flex-1 bg-base/80 border border-ink focus:border-sky/50 focus:ring-1 focus:ring-sky/25 outline-none transition-colors px-3 py-1.5 rounded-lg text-[13px] text-slate-text placeholder:text-slate-muted"
        />
        <button onClick={() => add(input)} className="px-3 py-1.5 text-[12px] text-sky border border-sky/30 bg-sky/10 hover:bg-sky/20 rounded-lg transition-all">
          Add
        </button>
      </div>
      {fresh.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
          <span className="text-[11px] text-slate-muted">Suggestions:</span>
          {fresh.map((sk) => (
            <button
              key={sk}
              onClick={() => add(sk)}
              className="flex items-center gap-1 px-2 py-0.5 text-[11px] text-slate-muted border border-ink border-dashed hover:text-sky hover:border-sky/40 rounded-md transition-all"
            >
              <Plus size={10} /> {sk}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** One task's provider + model (ADR 0025). Model is a dropdown of the provider's known
 *  models (so you select instead of typing), plus a "Custom…" option that reveals a text
 *  field — so any other model id still works. */
function TaskModel({
  title,
  hint,
  provider,
  model,
  onProvider,
  onModel,
}: {
  title: string;
  hint: string;
  provider: string;
  model: string;
  onProvider: (v: string) => void;
  onModel: (v: string) => void;
}) {
  const known = MODELS[provider] ?? [];
  // A model that isn't one of the provider's known ids is a custom one — show the text
  // field and keep the dropdown on "Custom…".
  const isCustom = !known.includes(model);
  return (
    <div className="bg-raised border border-ink rounded-lg p-3.5">
      <p className="text-[13px] font-medium text-slate-text">{title}</p>
      <p className="text-[11px] text-slate-muted mb-3">{hint}</p>
      <p className="text-[11px] text-slate-muted mb-1.5 font-medium uppercase tracking-wider">Provider</p>
      <select
        value={provider}
        onChange={(e) => onProvider(e.target.value)}
        className="w-full bg-base/80 border border-ink focus:border-sky/50 focus:ring-1 focus:ring-sky/25 outline-none transition-colors px-3 py-2 rounded-lg text-[13px] text-slate-text mb-3"
      >
        {PROVIDERS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>
      <p className="text-[11px] text-slate-muted mb-1.5 font-medium uppercase tracking-wider">Model</p>
      <select
        value={isCustom ? CUSTOM_MODEL : model}
        onChange={(e) => {
          const v = e.target.value;
          // Picking "Custom…" clears the field so the text input opens ready to type.
          onModel(v === CUSTOM_MODEL ? '' : v);
        }}
        className="w-full bg-base/80 border border-ink focus:border-sky/50 focus:ring-1 focus:ring-sky/25 outline-none transition-colors px-3 py-2 rounded-lg text-[13px] text-slate-text font-mono"
      >
        {known.map((m) => (
          <option key={m} value={m}>
            {MODEL_LABELS[m] ?? m}
          </option>
        ))}
        <option value={CUSTOM_MODEL}>Custom…</option>
      </select>
      {isCustom && (
        <input
          value={model}
          onChange={(e) => onModel(e.target.value)}
          placeholder="Enter a model id (e.g. gpt-4.1-nano)"
          autoFocus
          className="w-full mt-2 bg-base/80 border border-ink focus:border-sky/50 focus:ring-1 focus:ring-sky/25 outline-none transition-colors px-3 py-2 rounded-lg text-[13px] text-slate-text font-mono placeholder:text-slate-muted"
        />
      )}
    </div>
  );
}

function SettingsCategoryIcon({ category }: { category: SettingsCategory }) {
  if (category === 'search') return <Search size={16} />;
  if (category === 'automation') return <Clock3 size={16} />;
  if (category === 'ai') return <Sparkles size={16} />;
  if (category === 'integrations') return <KeyRound size={16} />;
  return <SlidersHorizontal size={16} />;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card p-5 mb-5">
      <div className="mb-4 flex items-center gap-2">
        <span className="h-3.5 w-1 rounded-full bg-gradient-to-b from-sky to-iris" />
        <h2 className="font-display text-[12px] font-semibold uppercase tracking-[0.12em] text-slate-muted">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  hint,
}: {
  label: string;
  value: unknown;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  hint?: string;
}) {
  return (
    <div>
      <p className="text-[11px] text-slate-muted mb-1.5 font-medium uppercase tracking-wider">{label}</p>
      <input
        type={type}
        value={(value as string) ?? ''}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-base/80 border border-ink focus:border-sky/50 focus:ring-1 focus:ring-sky/25 outline-none transition-colors px-3 py-2 rounded-lg text-[13px] text-slate-text placeholder:text-slate-muted transition-colors"
      />
      {hint && <p className="mt-1.5 text-[10px] leading-relaxed text-slate-muted">{hint}</p>}
    </div>
  );
}

/**
 * A persistent library of options (roles or locations) with click-to-select
 * (ADR 0016). Selected options are highlighted and are what the run actually
 * searches; the rest stay saved for later. Add via the input or a suggestion;
 * the × removes one from the library entirely.
 */
function LibraryPicker({
  label,
  options,
  selected,
  suggestions = [],
  suggestionGroups,
  placeholder,
  onToggle,
  onAdd,
  onRemove,
}: {
  label: string;
  options: string[];
  selected: string[];
  suggestions?: string[];
  /** Optional categorized suggestions (e.g. locations grouped by area). When given,
   *  they replace the flat `suggestions` row with labeled groups. */
  suggestionGroups?: { label: string; items: string[] }[];
  placeholder?: string;
  onToggle: (v: string) => void;
  onAdd: (v: string) => void;
  onRemove: (v: string) => void;
}) {
  const [input, setInput] = useState('');
  function add() {
    const v = input.trim();
    if (v) {
      onAdd(v);
      setInput('');
    }
  }
  const freshSuggestions = suggestions.filter((sug) => !options.includes(sug));

  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[11px] text-slate-muted font-medium uppercase tracking-wider">{label}</p>
        <span className="text-[11px] text-slate-muted">
          {selected.length} of {options.length} selected
        </span>
      </div>

      <div className="flex flex-wrap gap-2 mb-2.5">
        {options.length === 0 && <span className="text-[12px] text-slate-muted">None yet — add one below.</span>}
        {options.map((opt) => {
          const on = selected.includes(opt);
          return (
            <span
              key={opt}
              className={`group flex items-center rounded-md border text-[12px] transition-all ${
                on ? 'bg-sky/15 border-sky/40 text-sky' : 'bg-raised border-ink text-slate-muted hover:text-slate-text'
              }`}
            >
              <button onClick={() => onToggle(opt)} className="flex items-center gap-1.5 pl-2 pr-1.5 py-1" title={on ? 'Selected — click to deselect' : 'Click to select'}>
                {on ? <Check size={12} className="shrink-0" /> : <span className="w-3 shrink-0" />}
                {opt}
              </button>
              <button
                onClick={() => onRemove(opt)}
                title="Remove from list"
                className="pr-1.5 py-1 text-slate-muted/60 hover:text-rose transition-colors"
              >
                <X size={12} />
              </button>
            </span>
          );
        })}
      </div>

      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder={placeholder ?? 'Add…'}
          className="flex-1 bg-base/80 border border-ink focus:border-sky/50 focus:ring-1 focus:ring-sky/25 outline-none transition-colors px-3 py-1.5 rounded-lg text-[13px] text-slate-text placeholder:text-slate-muted"
        />
        <button onClick={add} className="px-3 py-1.5 text-[12px] text-sky border border-sky/30 bg-sky/10 hover:bg-sky/20 rounded-lg transition-all">
          Add
        </button>
      </div>

      {/* Categorized suggestions (locations) — labeled groups so the quieter, lower-
          competition areas are easy to spot. Falls back to the flat row otherwise. */}
      {suggestionGroups ? (
        <div className="mt-3 space-y-2.5">
          {suggestionGroups.map((group) => {
            const fresh = group.items.filter((it) => !options.includes(it));
            if (fresh.length === 0) return null;
            return (
              <div key={group.label}>
                <p className="text-[10px] text-slate-muted/80 uppercase tracking-wider mb-1">{group.label}</p>
                <div className="flex flex-wrap items-center gap-1.5">
                  {fresh.map((sug) => (
                    <button
                      key={sug}
                      onClick={() => onAdd(sug)}
                      className="flex items-center gap-1 px-2 py-0.5 text-[11px] text-slate-muted border border-ink border-dashed hover:text-sky hover:border-sky/40 rounded-md transition-all"
                    >
                      <Plus size={10} /> {sug}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : freshSuggestions.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
          <span className="text-[11px] text-slate-muted">Suggestions:</span>
          {freshSuggestions.map((sug) => (
            <button
              key={sug}
              onClick={() => onAdd(sug)}
              className="flex items-center gap-1 px-2 py-0.5 text-[11px] text-slate-muted border border-ink border-dashed hover:text-sky hover:border-sky/40 rounded-md transition-all"
            >
              <Plus size={10} /> {sug}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SaveBtn({ onClick, loading }: { onClick: () => void; loading: boolean }) {
  return (
    <button onClick={onClick} disabled={loading} className="btn-primary px-5 py-2.5">
      <Save size={14} /> {loading ? 'Saving…' : 'Save settings'}
    </button>
  );
}
