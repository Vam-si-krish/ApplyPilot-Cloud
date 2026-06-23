'use client';

import { useEffect, useState } from 'react';
import { Save, CheckCircle, Trash2, Plus, X, Mail, Check } from 'lucide-react';
import type { Settings, ApiKeyMasked, ApiKeyProvider, GmailStatus } from '@/lib/types';

const PROVIDERS = [
  { id: 'gemini', label: 'Google Gemini', model: 'gemini-2.0-flash' },
  { id: 'openai', label: 'OpenAI', model: 'gpt-4o-mini' },
  { id: 'deepseek', label: 'DeepSeek', model: 'deepseek-chat' },
  { id: 'anthropic', label: 'Anthropic Claude', model: 'claude-sonnet-4-6' },
];

// Known models per provider (datalist suggestions; the field stays editable).
const MODELS: Record<string, string[]> = {
  openai: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1'],
  anthropic: ['claude-sonnet-4-6', 'claude-haiku-4-5-20251001', 'claude-opus-4-8'],
  gemini: ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-2.5-pro'],
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
};
const defaultModel = (provider: string) => MODELS[provider]?.[0] ?? '';

const ACTORS = [
  { id: 'bebity~linkedin-jobs-scraper', label: 'Standard (bebity)' },
  { id: 'cheap_scraper~linkedin-job-scraper', label: 'Cheapest (cheap_scraper)' },
  { id: 'fascinating_lentil~linkedin-jobs-scraper', label: 'Alternative (fascinating_lentil)' },
];

// One-click suggestions to seed the libraries (ADR 0016). Adding one drops it into
// the saved list; it persists and can be selected/deselected like any other.
const KEYWORD_SUGGESTIONS = [
  'Software Engineer', 'Backend Engineer', 'Frontend Engineer', 'Full Stack Engineer',
  'Data Engineer', 'Machine Learning Engineer', 'DevOps Engineer', 'Platform Engineer',
];
const LOCATION_SUGGESTIONS = [
  'Boston, MA', 'Cambridge, MA', 'Worcester, MA', 'Providence, RI', 'Hartford, CT',
  'Stamford, CT', 'New York, NY', 'Manchester, NH', 'Portland, ME', 'Remote, US', 'United States',
];
const SKILL_SUGGESTIONS = [
  'React', 'TypeScript', 'JavaScript', 'Node.js', 'Next.js', 'Python', 'SQL', 'AWS', 'GraphQL', 'Docker',
];

export default function SettingsPage() {
  const [s, setS] = useState<Settings | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  // New worker secret to set (write-only). Empty = leave the saved one unchanged;
  // s.resume_worker_secret holds only a masked preview from the GET.
  const [workerSecret, setWorkerSecret] = useState('');

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setS(d))
      .catch(() => {});
  }, []);

  function patch(p: Partial<Settings>) {
    setS((prev) => (prev ? { ...prev, ...p } : prev));
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

  async function save() {
    if (!s) return;
    setSaving(true);
    try {
      // Only send a new worker secret when one was typed; otherwise the masked value
      // in `s` is sent and the server ignores it (so the saved secret is preserved).
      const newSecret = workerSecret.trim();
      const body = newSecret ? { ...s, resume_worker_secret: newSecret } : s;
      await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      // Reflect the newly-set secret as a masked preview and clear the input.
      if (newSecret) {
        patch({ resume_worker_secret: `••••••${newSecret.slice(-4)}` });
        setWorkerSecret('');
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
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

  return (
    <div className="p-4 sm:p-6 lg:p-7 animate-slide-up max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-text tracking-tight">Settings</h1>
          <p className="text-slate-muted text-[13px] mt-0.5">Schedule, search criteria, and providers</p>
        </div>
        {saved && (
          <div className="flex items-center gap-1.5 text-[13px] text-emerald animate-fade-in">
            <CheckCircle size={14} /> Saved
          </div>
        )}
      </div>

      {/* Schedule */}
      <Section title="Daily Schedule">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Run time (HH:MM)" value={s.schedule_time} onChange={(v) => patch({ schedule_time: v })} placeholder="06:00" />
          <Field label="Timezone (IANA)" value={s.timezone} onChange={(v) => patch({ timezone: v })} placeholder="America/New_York" />
        </div>
        <div className="mt-5 flex items-center gap-2">
          <input
            type="checkbox"
            id="auto_scrape_enabled"
            checked={s.auto_scrape_enabled ?? true}
            onChange={(e) => patch({ auto_scrape_enabled: e.target.checked })}
            className="w-4 h-4 rounded border-ink text-sky focus:ring-sky bg-raised"
          />
          <label htmlFor="auto_scrape_enabled" className="text-[13px] text-slate-text">Enable automated daily runs</label>
        </div>
        <p className="text-slate-muted text-[11px] mt-3">
          Vercel Cron triggers <span className="font-mono text-sky">/api/run</span> on a UTC schedule. Update{' '}
          <span className="font-mono text-sky">vercel.json</span> to match this time in UTC (see the README). Unchecking the box above will pause automated scrapes.
        </p>
      </Section>

      {/* Search */}
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
          suggestions={LOCATION_SUGGESTIONS}
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
                className="w-20 bg-card border border-ink focus:border-sky/40 outline-none px-3 py-1.5 rounded-lg text-[13px] text-slate-text font-mono"
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
          <Field label="Hours old (lookback)" value={String(s.hours_old)} onChange={(v) => patch({ hours_old: Number(v) || 24 })} />
          <Field label="Results per role" value={String(s.results_per_query)} onChange={(v) => patch({ results_per_query: Number(v) || 50 })} />
          <Field
            label="Max jobs / run (0 = ∞)"
            value={String(s.max_jobs_per_run ?? 0)}
            onChange={(v) => patch({ max_jobs_per_run: Math.max(0, Number(v) || 0) })}
            placeholder="0"
          />
        </div>

        {/* Fetch strategy (ADR 0023) */}
        <div className="mt-4">
          <p className="text-[11px] text-slate-muted mb-1.5 font-medium uppercase tracking-wider">Fetch mode</p>
          <select
            value={s.fetch_mode ?? 'url'}
            onChange={(e) => patch({ fetch_mode: e.target.value as 'url' | 'keyword' })}
            className="w-full sm:w-auto bg-raised border border-ink focus:border-sky/40 outline-none px-3 py-2 rounded-lg text-[13px] text-slate-text"
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

      {/* AI Models — per task (ADR 0025) */}
      <Section title="AI Models">
        <p className="text-slate-muted text-[12px] mb-4">
          Choose a model per task. <span className="text-sky">Scoring</span> runs on every fetched job (high volume) — pick a
          cheap, consistent model. <span className="text-sky">Tailoring</span> rewrites your résumé for each job — pick a premium
          model. Each task uses the <span className="text-emerald">active key</span> for its provider (set in API Keys below);
          environment variables are only a fallback.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <TaskModel
            title="Scoring"
            hint="High volume · cheap & consistent (e.g. GPT-4o-mini)"
            provider={s.score_provider ?? 'openai'}
            model={s.score_model ?? 'gpt-4o-mini'}
            onProvider={(prov) => patch({ score_provider: prov, score_model: defaultModel(prov) })}
            onModel={(v) => patch({ score_model: v })}
          />
          <TaskModel
            title="Tailoring"
            hint="Quality · truthful rewriting (e.g. Claude Sonnet 4.6)"
            provider={s.tailor_provider ?? 'anthropic'}
            model={s.tailor_model ?? 'claude-sonnet-4-6'}
            onProvider={(prov) => patch({ tailor_provider: prov, tailor_model: defaultModel(prov) })}
            onModel={(v) => patch({ tailor_model: v })}
          />
        </div>
      </Section>

      {/* Pre-scoring filter */}
      <Section title="Pre-scoring Filter">
        <p className="text-slate-muted text-[12px] mb-4">
          Before spending an LLM call on each job, a cheap local check rates your résumé against the posting
          (IDF-weighted keyword coverage — what share of the job&apos;s meaningful terms your résumé covers). Jobs below the
          threshold are marked <span className="text-amber-400">Filtered</span> and skipped, saving tokens. Turn it off to score
          every job.
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
        <div className="grid grid-cols-2 gap-4">
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
          The match % is computed when jobs are fetched and shown on each job, so you can tune the threshold against real numbers.
          Filtered jobs stay visible under the <span className="text-amber-400">Filtered</span> tab on the Jobs page.
        </p>
      </Section>

      {/* Company assessment (daily pipeline) */}
      <Section title="Company Assessment">
        <p className="text-slate-muted text-[12px] mb-4">
          After the daily run scores jobs, it can automatically AI-assess the companies behind your high scorers
          (good / medium / low / unknown) — so the Jobs page can default to strong jobs at solid companies. Only jobs scoring
          at or above the threshold are assessed.
        </p>
        <div className="flex items-start gap-3 bg-raised border border-ink rounded-lg px-3.5 py-3 mb-4">
          <button
            role="switch"
            aria-checked={s.auto_assess_enabled ?? true}
            onClick={() => patch({ auto_assess_enabled: !(s.auto_assess_enabled ?? true) })}
            className={`mt-0.5 shrink-0 w-9 h-5 rounded-full transition-colors relative ${s.auto_assess_enabled ?? true ? 'bg-emerald/80' : 'bg-ink'}`}
          >
            <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${s.auto_assess_enabled ?? true ? 'left-[18px]' : 'left-0.5'}`} />
          </button>
          <div>
            <p className="text-[13px] font-medium text-slate-text">Auto-assess companies after scoring</p>
            <p className="text-[11px] text-slate-muted mt-0.5">Off = company assessment stays on-demand only (the “Assess companies” button).</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field
            label="Minimum fit score to assess"
            value={String(s.auto_assess_min_score ?? 6)}
            onChange={(v) => patch({ auto_assess_min_score: Math.max(0, Math.min(10, Number(v) || 0)) })}
            placeholder="6"
          />
        </div>
      </Section>

      {/* API Keys vault */}
      <ApiKeysSection autoRotate={s.auto_rotate_keys ?? false} onAutoRotate={setAutoRotate} />

      {/* Gmail inbox connection */}
      <GmailSection />

      {/* Portals */}
      <Section title="Job Portals">
        <p className="text-slate-muted text-[12px] mb-4">
          Select which job boards to search. Each uses a separate Apify actor and runs in parallel.
        </p>
        <div className="flex flex-col gap-3 mb-5">
          {[
            { key: 'linkedin',  label: 'LinkedIn',  actor: 'bebity~linkedin-jobs-scraper (configurable below)' },
            { key: 'indeed',    label: 'Indeed',    actor: 'misceres~indeed-scraper' },
            { key: 'glassdoor', label: 'Glassdoor', actor: 'bebity~glassdoor-jobs-scraper' },
          ].map(({ key, label, actor }) => {
            const portals = s.job_portals ?? ['linkedin'];
            const checked = portals.includes(key);
            return (
              <label key={key} className="flex items-center gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...portals, key]
                      : portals.filter((p) => p !== key);
                    patch({ job_portals: next.length ? next : ['linkedin'] });
                  }}
                  className="w-4 h-4 rounded border-ink text-sky focus:ring-sky bg-raised"
                />
                <span className="text-[13px] text-slate-text font-medium w-24">{label}</span>
                <span className="text-[11px] text-slate-muted font-mono">{actor}</span>
              </label>
            );
          })}
        </div>

        {/* LinkedIn actor variant — only shown when LinkedIn is selected */}
        {(s.job_portals ?? ['linkedin']).includes('linkedin') && (
          <div className="pt-4 border-t border-ink">
            <p className="text-[11px] text-slate-muted mb-3 font-medium uppercase tracking-wider">LinkedIn Actor Variant</p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <select
                  value={ACTORS.find((a) => a.id === s.apify_actor_id) ? s.apify_actor_id : 'custom'}
                  onChange={(e) => { if (e.target.value !== 'custom') patch({ apify_actor_id: e.target.value }); }}
                  className="w-full bg-raised border border-ink focus:border-sky/40 outline-none px-3 py-2 rounded-lg text-[13px] text-slate-text"
                >
                  {ACTORS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                  <option value="custom">Custom...</option>
                </select>
              </div>
              <Field
                label="Actor ID"
                value={s.apify_actor_id}
                onChange={(v) => patch({ apify_actor_id: v.replace(/\//g, '~') })}
                placeholder="bebity~linkedin-jobs-scraper"
              />
            </div>
          </div>
        )}

        <p className="text-slate-muted text-[11px] mt-4">
          The Apify token comes from the active <span className="text-sky">Apify</span> key in the API Keys section above
          (falling back to <span className="font-mono text-sky">APIFY_TOKEN</span>). Indeed and Glassdoor actor IDs are
          defaults — verify on <span className="font-mono text-sky">console.apify.com</span> before first use.
        </p>
      </Section>

      {/* Résumé Worker */}
      <Section title="Résumé Worker">
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
          />
          <div>
            <Field
              label="Worker secret"
              type="password"
              value={workerSecret}
              onChange={setWorkerSecret}
              placeholder={s.resume_worker_secret ? 'Saved — type a new value to replace it' : 'Set the shared worker secret'}
            />
            <p className="text-slate-muted text-[11px] mt-1.5">
              {s.resume_worker_secret
                ? `A secret is saved (${s.resume_worker_secret}). Leave blank to keep it; enter a new value to replace it.`
                : 'No secret saved — the RESUME_WORKER_SECRET env var is used if set.'}
            </p>
          </div>
        </div>
      </Section>

      <SaveBtn onClick={save} loading={saving} />
    </div>
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
        <span className="text-emerald">active</span>. The active key is used for daily runs and scoring; environment
        variables are only a fallback when a provider has no key here. Keys are shown masked — re-enter to replace.
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
          className="flex items-center gap-1.5 px-2.5 py-1 text-[12px] text-sky border border-sky/30 bg-sky/5 hover:bg-sky/15 rounded-lg transition-all"
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
              <span className="text-[12px] text-slate-muted font-mono ml-auto">{k.key_preview}</span>
              <button onClick={() => onRemove(k.id)} title="Delete key" className="shrink-0 text-slate-muted hover:text-rose transition-colors">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        !loading && <p className="text-[12px] text-slate-muted">No keys stored — using env fallback if set.</p>
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
        className="w-full max-w-lg bg-card border border-ink rounded-xl p-5 shadow-2xl animate-slide-up"
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
                className="w-32 bg-raised border border-ink focus:border-sky/40 outline-none px-3 py-1.5 rounded-lg text-[13px] text-slate-text placeholder:text-slate-muted"
              />
              <input
                value={r.value}
                onChange={(e) => update(i, 'value', e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && save()}
                placeholder={meta.placeholder}
                type="password"
                autoComplete="off"
                autoFocus={i === 0}
                className="flex-1 min-w-0 bg-raised border border-ink focus:border-sky/40 outline-none px-3 py-1.5 rounded-lg text-[13px] text-slate-text placeholder:text-slate-muted font-mono"
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
        Connect Gmail to auto-classify incoming job mail (applied · shortlisted · action needed · assessment · rejection) and
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
                className="w-full bg-raised border border-ink focus:border-sky/40 outline-none px-3 py-2 rounded-lg text-[13px] text-slate-text placeholder:text-slate-muted font-mono"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={saveCreds}
              disabled={busy}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-sky border border-sky/30 bg-sky/5 hover:bg-sky/15 disabled:opacity-40 rounded-lg transition-all"
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
          className="flex-1 bg-raised border border-ink focus:border-sky/40 outline-none px-3 py-1.5 rounded-lg text-[13px] text-slate-text placeholder:text-slate-muted"
        />
        <button onClick={() => add(input)} className="px-3 py-1.5 text-[12px] text-sky border border-sky/30 bg-sky/5 hover:bg-sky/15 rounded-lg transition-all">
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

/** One task's provider + model (ADR 0025). Model is a free text field with
 *  per-provider suggestions via a datalist, so any model name still works. */
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
  const listId = `models-${title.toLowerCase()}`;
  return (
    <div className="bg-raised border border-ink rounded-lg p-3.5">
      <p className="text-[13px] font-medium text-slate-text">{title}</p>
      <p className="text-[11px] text-slate-muted mb-3">{hint}</p>
      <p className="text-[11px] text-slate-muted mb-1.5 font-medium uppercase tracking-wider">Provider</p>
      <select
        value={provider}
        onChange={(e) => onProvider(e.target.value)}
        className="w-full bg-card border border-ink focus:border-sky/40 outline-none px-3 py-2 rounded-lg text-[13px] text-slate-text mb-3"
      >
        {PROVIDERS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>
      <p className="text-[11px] text-slate-muted mb-1.5 font-medium uppercase tracking-wider">Model</p>
      <input
        list={listId}
        value={model}
        onChange={(e) => onModel(e.target.value)}
        className="w-full bg-card border border-ink focus:border-sky/40 outline-none px-3 py-2 rounded-lg text-[13px] text-slate-text font-mono placeholder:text-slate-muted"
      />
      <datalist id={listId}>
        {(MODELS[provider] ?? []).map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-card border border-ink rounded-xl p-5 mb-5">
      <p className="text-[12px] font-semibold text-slate-muted uppercase tracking-wider font-display mb-4">{title}</p>
      {children}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string;
  value: unknown;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div>
      <p className="text-[11px] text-slate-muted mb-1.5 font-medium uppercase tracking-wider">{label}</p>
      <input
        type={type}
        value={(value as string) ?? ''}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-raised border border-ink focus:border-sky/40 outline-none px-3 py-2 rounded-lg text-[13px] text-slate-text placeholder:text-slate-muted transition-colors"
      />
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
  placeholder,
  onToggle,
  onAdd,
  onRemove,
}: {
  label: string;
  options: string[];
  selected: string[];
  suggestions?: string[];
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
          className="flex-1 bg-raised border border-ink focus:border-sky/40 outline-none px-3 py-1.5 rounded-lg text-[13px] text-slate-text placeholder:text-slate-muted"
        />
        <button onClick={add} className="px-3 py-1.5 text-[12px] text-sky border border-sky/30 bg-sky/5 hover:bg-sky/15 rounded-lg transition-all">
          Add
        </button>
      </div>

      {freshSuggestions.length > 0 && (
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
      )}
    </div>
  );
}

function SaveBtn({ onClick, loading }: { onClick: () => void; loading: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="flex items-center gap-2 px-5 py-2.5 bg-sky/10 text-sky border border-sky/30 hover:bg-sky/20 disabled:opacity-40 rounded-lg text-[13px] font-medium transition-all"
    >
      <Save size={14} /> {loading ? 'Saving…' : 'Save Changes'}
    </button>
  );
}
