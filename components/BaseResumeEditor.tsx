'use client';

import { useEffect, useState } from 'react';
import { Save, CheckCircle, AlertCircle } from 'lucide-react';
import ResumeFields from '@/components/ResumeFields';
import type { ResumeDoc } from '@/lib/types';

/**
 * Editable base résumé (ADR 0024) — the single source of truth (ADR 0036). This one
 * structured résumé drives scoring, per-job tailoring, and cover letters; it's edited
 * here and nowhere else.
 */

function emptyDoc(): ResumeDoc {
  return { basics: {}, work: [], education: [], skills: [], projects: [] };
}

export default function BaseResumeEditor() {
  const [doc, setDoc] = useState<ResumeDoc | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/base-resume')
      .then((r) => (r.ok ? r.json() : { base_resume: null }))
      .then((d) => setDoc(d.base_resume ?? null))
      .catch(() => setDoc(null))
      .finally(() => setLoaded(true));
  }, []);

  const d = doc ?? emptyDoc();

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const r = await fetch('/api/base-resume', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base_resume: d }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Save failed');
      setDoc(data.base_resume ?? d);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) {
    return <div className="h-40 bg-card border border-ink rounded-xl animate-pulse" />;
  }

  const isEmpty = !doc || (!d.basics.name && d.work.length === 0 && d.skills.length === 0);

  return (
    <div className="space-y-5">
      <div>
        <p className="text-[13px] text-slate-text font-medium">Base résumé</p>
        <p className="text-slate-muted text-[12px]">
          Your one résumé — it drives scoring, per-job tailoring, and cover letters. Never fabricated, always your real
          experience. Edit it here; this is the only place it lives.
        </p>
      </div>

      {error && (
        <div className="flex items-start gap-2 px-3 py-2 text-[12px] text-rose bg-rose/10 border border-rose/30 rounded-lg">
          <AlertCircle size={14} className="mt-0.5 shrink-0" /> {error}
        </div>
      )}

      {isEmpty && (
        <div className="bg-card border border-ink rounded-xl px-6 py-10 text-center">
          <p className="text-[13px] text-slate-text mb-1">No base résumé yet</p>
          <p className="text-[12px] text-slate-muted max-w-md mx-auto">
            Fill in your details below and <span className="text-sky">Save</span> — this becomes the résumé used everywhere
            (scoring, tailoring, cover letters).
          </p>
        </div>
      )}

      <ResumeFields value={d} onChange={setDoc} />

      <div className="flex items-center gap-3 sticky bottom-0 bg-void/80 backdrop-blur py-3">
        <button
          onClick={save}
          disabled={saving}
          className="flex items-center gap-2 px-5 py-2.5 bg-sky/10 text-sky border border-sky/30 hover:bg-sky/20 disabled:opacity-40 rounded-lg text-[13px] font-medium transition-all"
        >
          <Save size={14} /> {saving ? 'Saving…' : 'Save base résumé'}
        </button>
        {saved && (
          <span className="flex items-center gap-1.5 text-[13px] text-emerald animate-fade-in">
            <CheckCircle size={14} /> Saved
          </span>
        )}
      </div>
    </div>
  );
}
