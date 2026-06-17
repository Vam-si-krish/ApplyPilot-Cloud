'use client';

import { useEffect, useState } from 'react';
import { Save, CheckCircle } from 'lucide-react';
import type { Profile } from '@/lib/types';

type Tab = 'personal' | 'work' | 'skills' | 'resume';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Form = any;

export default function ProfilePage() {
  const [tab, setTab] = useState<Tab>('personal');
  const [form, setForm] = useState<Form | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  // Load once; sync remote → local via effect (never setState during render —
  // that loops when the fetched value equals current state; the bug the brief flagged).
  useEffect(() => {
    fetch('/api/profile')
      .then((r) => (r.ok ? r.json() : {}))
      .then((p: Partial<Profile>) => setForm(structuredClone(p ?? {})))
      .catch(() => setForm({}));
  }, []);

  function set(path: string, value: unknown) {
    const parts = path.split('.');
    const clone = structuredClone(form ?? {});
    let cur = clone;
    for (let i = 0; i < parts.length - 1; i++) {
      if (cur[parts[i]] == null || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
    setForm(clone);
  }

  async function save() {
    setSaving(true);
    try {
      await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  if (!form) {
    return (
      <div className="p-7">
        <div className="h-8 w-40 bg-raised rounded animate-pulse mb-6" />
        <div className="grid grid-cols-2 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-16 bg-card border border-ink rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'personal', label: 'Personal' },
    { id: 'work', label: 'Work Auth' },
    { id: 'skills', label: 'Skills' },
    { id: 'resume', label: 'Resume' },
  ];

  return (
    <div className="p-7 animate-slide-up">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-text tracking-tight">Profile</h1>
          <p className="text-slate-muted text-[13px] mt-0.5">Your application data — the resume text drives scoring</p>
        </div>
        {saved && (
          <div className="flex items-center gap-1.5 text-[13px] text-emerald animate-fade-in">
            <CheckCircle size={14} /> Saved
          </div>
        )}
      </div>

      <div className="flex gap-1 mb-5 border-b border-ink">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-[13px] font-medium border-b-2 -mb-px transition-all ${
              tab === t.id ? 'border-sky text-sky' : 'border-transparent text-slate-muted hover:text-slate-text'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="animate-slide-up">
        {tab === 'personal' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Full Name" value={form.personal?.full_name} onChange={(v) => set('personal.full_name', v)} />
              <Field label="Email" value={form.personal?.email} onChange={(v) => set('personal.email', v)} />
              <Field label="Phone" value={form.personal?.phone} onChange={(v) => set('personal.phone', v)} />
              <Field label="City" value={form.personal?.city} onChange={(v) => set('personal.city', v)} />
              <Field label="LinkedIn URL" value={form.personal?.linkedin_url} onChange={(v) => set('personal.linkedin_url', v)} />
              <Field label="GitHub URL" value={form.personal?.github_url} onChange={(v) => set('personal.github_url', v)} />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <Field label="Years of Experience" value={form.experience?.years_of_experience_total} onChange={(v) => set('experience.years_of_experience_total', v)} />
              <Field label="Target Role" value={form.experience?.target_role} onChange={(v) => set('experience.target_role', v)} />
              <Field label="Education Level" value={form.experience?.education_level} onChange={(v) => set('experience.education_level', v)} />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <Field label="Min Salary ($)" value={form.compensation?.salary_range_min} onChange={(v) => set('compensation.salary_range_min', v)} />
              <Field label="Max Salary ($)" value={form.compensation?.salary_range_max} onChange={(v) => set('compensation.salary_range_max', v)} />
            </div>
            <SaveBtn onClick={save} loading={saving} />
          </div>
        )}

        {tab === 'work' && (
          <div className="space-y-4">
            <div className="bg-card border border-ink rounded-xl p-5 space-y-4">
              <Toggle
                label="Legally authorized to work in US"
                value={!!form.work_authorization?.legally_authorized_to_work}
                onChange={(v) => set('work_authorization.legally_authorized_to_work', v)}
              />
              <Toggle
                label="Requires visa sponsorship"
                value={!!form.work_authorization?.require_sponsorship}
                onChange={(v) => set('work_authorization.require_sponsorship', v)}
              />
              <Field
                label="Work Permit Type (leave blank if none)"
                value={form.work_authorization?.work_permit_type}
                onChange={(v) => set('work_authorization.work_permit_type', v)}
              />
            </div>
            <SaveBtn onClick={save} loading={saving} />
          </div>
        )}

        {tab === 'skills' && (
          <div className="space-y-4">
            <TagField label="Programming Languages" tags={form.skills_boundary?.programming_languages ?? []} onChange={(v) => set('skills_boundary.programming_languages', v)} />
            <TagField label="Frameworks" tags={form.skills_boundary?.frameworks ?? []} onChange={(v) => set('skills_boundary.frameworks', v)} />
            <TagField label="Tools" tags={form.skills_boundary?.tools ?? []} onChange={(v) => set('skills_boundary.tools', v)} />
            <SaveBtn onClick={save} loading={saving} />
          </div>
        )}

        {tab === 'resume' && (
          <div className="space-y-4">
            <div className="bg-card border border-ink rounded-xl p-5">
              <p className="text-[12px] font-semibold text-slate-muted uppercase tracking-wider font-display mb-1">Resume Text</p>
              <p className="text-slate-muted text-[12px] mb-3">Used by the AI scorer to rate each job. Paste your full resume as plain text.</p>
              <textarea
                value={form.resume_text ?? ''}
                onChange={(e) => set('resume_text', e.target.value)}
                rows={22}
                className="w-full bg-raised border border-ink focus:border-sky/40 outline-none px-4 py-3 rounded-lg text-[12px] font-mono text-slate-text resize-y"
              />
            </div>
            <SaveBtn onClick={save} loading={saving} />
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: unknown; onChange: (v: string) => void }) {
  return (
    <div>
      <p className="text-[11px] text-slate-muted mb-1.5 font-medium uppercase tracking-wider">{label}</p>
      <input
        value={(value as string) ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-raised border border-ink focus:border-sky/40 outline-none px-3 py-2 rounded-lg text-[13px] text-slate-text transition-colors"
      />
    </div>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-3 cursor-pointer">
      <div
        onClick={() => onChange(!value)}
        className={`w-10 h-5 rounded-full border transition-all relative ${value ? 'bg-sky/20 border-sky/40' : 'bg-raised border-ink'}`}
      >
        <div className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${value ? 'left-5 bg-sky' : 'left-0.5 bg-slate-muted'}`} />
      </div>
      <span className="text-[13px] text-slate-text">{label}</span>
      <span className={`text-[11px] font-mono ${value ? 'text-emerald' : 'text-rose'}`}>{value ? 'YES' : 'NO'}</span>
    </label>
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
    <div className="bg-card border border-ink rounded-xl p-5">
      <p className="text-[12px] font-semibold text-slate-muted uppercase tracking-wider font-display mb-3">{label}</p>
      <div className="flex flex-wrap gap-2 mb-3">
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
          placeholder="Add tag…"
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
