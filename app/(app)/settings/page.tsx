'use client';

import { useEffect, useState } from 'react';
import { Save, CheckCircle } from 'lucide-react';
import type { Settings } from '@/lib/types';

const PROVIDERS = [
  { id: 'gemini', label: 'Google Gemini', model: 'gemini-2.0-flash' },
  { id: 'openai', label: 'OpenAI', model: 'gpt-4o-mini' },
  { id: 'deepseek', label: 'DeepSeek', model: 'deepseek-chat' },
  { id: 'anthropic', label: 'Anthropic Claude', model: 'claude-haiku-4-5-20251001' },
];

const ACTORS = [
  { id: 'bebity~linkedin-jobs-scraper', label: 'Standard (bebity)' },
  { id: 'cheap_scraper~linkedin-jobs-scraper', label: 'Cheapest (cheap_scraper)' },
  { id: 'fascinating_lentil~linkedin-jobs-scraper', label: 'Alternative (fascinating_lentil)' },
];

export default function SettingsPage() {
  const [s, setS] = useState<Settings | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setS(d))
      .catch(() => {});
  }, []);

  function patch(p: Partial<Settings>) {
    setS((prev) => (prev ? { ...prev, ...p } : prev));
  }

  async function save() {
    if (!s) return;
    setSaving(true);
    try {
      await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(s),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  if (!s) {
    return (
      <div className="p-7">
        <div className="h-8 w-40 bg-raised rounded animate-pulse mb-6" />
        <div className="h-40 bg-card border border-ink rounded-xl animate-pulse" />
      </div>
    );
  }

  return (
    <div className="p-7 animate-slide-up max-w-3xl">
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
        <TagField label="Keywords" tags={s.keywords} onChange={(v) => patch({ keywords: v })} />
        <TagField label="Locations" tags={s.locations} onChange={(v) => patch({ locations: v })} />
        <div className="grid grid-cols-2 gap-4 mt-2">
          <Field label="Hours old (lookback window)" value={String(s.hours_old)} onChange={(v) => patch({ hours_old: Number(v) || 24 })} />
          <Field label="Results per query" value={String(s.results_per_query)} onChange={(v) => patch({ results_per_query: Number(v) || 50 })} />
        </div>
      </Section>

      {/* LLM */}
      <Section title="Scoring Provider">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-[11px] text-slate-muted mb-1.5 font-medium uppercase tracking-wider">Provider</p>
            <select
              value={s.llm_provider}
              onChange={(e) => {
                const prov = PROVIDERS.find((p) => p.id === e.target.value);
                patch({ llm_provider: e.target.value, llm_model: prov?.model ?? s.llm_model });
              }}
              className="w-full bg-raised border border-ink focus:border-sky/40 outline-none px-3 py-2 rounded-lg text-[13px] text-slate-text"
            >
              {PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <Field label="Model" value={s.llm_model} onChange={(v) => patch({ llm_model: v })} />
        </div>
        <p className="text-slate-muted text-[11px] mt-3">
          API keys are read from environment variables (e.g. <span className="font-mono text-sky">GEMINI_API_KEY</span>) — set them in
          Vercel, not here, so secrets never touch the database.
        </p>
      </Section>

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
          Set <span className="font-mono text-sky">APIFY_TOKEN</span> as an env variable (Vercel/Netlify → Environment Variables).
          Indeed and Glassdoor actor IDs are defaults — verify on{' '}
          <span className="font-mono text-sky">console.apify.com</span> before first use.
        </p>
      </Section>

      <SaveBtn onClick={save} loading={saving} />
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
}: {
  label: string;
  value: unknown;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <p className="text-[11px] text-slate-muted mb-1.5 font-medium uppercase tracking-wider">{label}</p>
      <input
        value={(value as string) ?? ''}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-raised border border-ink focus:border-sky/40 outline-none px-3 py-2 rounded-lg text-[13px] text-slate-text placeholder:text-slate-muted transition-colors"
      />
    </div>
  );
}

function TagField({ label, tags, onChange }: { label: string; tags: string[]; onChange: (v: string[]) => void }) {
  const [input, setInput] = useState('');
  function add() {
    const v = input.trim();
    if (v && !tags.includes(v)) {
      onChange([...tags, v]);
      setInput('');
    }
  }
  return (
    <div className="mb-2">
      <p className="text-[11px] text-slate-muted mb-2 font-medium uppercase tracking-wider">{label}</p>
      <div className="flex flex-wrap gap-2 mb-2">
        {tags.map((t) => (
          <span key={t} className="flex items-center gap-1.5 px-2.5 py-1 bg-sky/10 border border-sky/20 text-sky text-[12px] rounded-md">
            {t}
            <button onClick={() => onChange(tags.filter((x) => x !== t))} className="text-sky/50 hover:text-rose transition-colors leading-none">
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder="Add…"
          className="flex-1 bg-raised border border-ink focus:border-sky/40 outline-none px-3 py-1.5 rounded-lg text-[13px] text-slate-text"
        />
        <button onClick={add} className="px-3 py-1.5 text-[12px] text-sky border border-sky/30 bg-sky/5 hover:bg-sky/15 rounded-lg transition-all">
          Add
        </button>
      </div>
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
