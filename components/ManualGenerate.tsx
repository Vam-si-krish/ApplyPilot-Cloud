'use client';

import { useState } from 'react';
import { Sparkles, Download, AlertCircle, Upload, FileText } from 'lucide-react';
import ResumeFields from '@/components/ResumeFields';
import ChangesReview, { confirmTailorChanges } from '@/components/ChangesReview';
import type { ResumeDoc, TailorChanges } from '@/lib/types';

/**
 * Manual résumé generation (ADR 0024): paste a job description, tailor the base
 * résumé to it, edit, and download a PDF — no job row / application needed.
 * Reuses the same truthful tailoring + worker rendering as the scored flow.
 */
export default function ManualGenerate() {
  const [jd, setJd] = useState('');
  const [title, setTitle] = useState('');
  const [company, setCompany] = useState('');
  const [template, setTemplate] = useState('classic');
  const [resume, setResume] = useState<ResumeDoc | null>(null);
  const [changes, setChanges] = useState<TailorChanges | null>(null);
  const [generating, setGenerating] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!/\.(txt|md)$/i.test(f.name)) {
      setError('Please paste the text, or upload a .txt file. (PDF/Word upload isn’t supported yet.)');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setJd(String(reader.result || ''));
    reader.readAsText(f);
  }

  async function generate() {
    if (!jd.trim() || generating) return;
    setGenerating(true);
    setError(null);
    setNote(null);
    try {
      const r = await fetch('/api/resume/tailor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobDescription: jd, title, company }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Generation failed');
      setResume(d.resume);
      setChanges(d.changes ?? null);
      setNote('Tailored — review the AI’s additions and your résumé below, then download.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not generate.');
    } finally {
      setGenerating(false);
    }
  }

  async function download() {
    if (!resume || downloading) return;
    // Make the user confirm anything the AI added/embellished before they use it.
    if (!confirmTailorChanges(changes)) return;
    setDownloading(true);
    setError(null);
    try {
      const filename = `Resume${company ? '_' + company.replace(/[^\w]+/g, '') : ''}.pdf`;
      const r = await fetch('/api/resume/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resume, template, filename }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || `Render failed (${r.status})`);
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      if (r.headers.get('X-Resume-Too-Long') === 'true') {
        setNote('Downloaded — content was long, trimmed to fit one page (consider shortening).');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not download the PDF.');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="text-[13px] text-slate-text font-medium">Quick generate from a job description</p>
        <p className="text-slate-muted text-[12px]">
          Paste any job description and get a résumé tailored to it (truthful — reframes your real experience). Uses your{' '}
          <span className="text-sky">base résumé</span> as the source.
        </p>
      </div>

      {error && (
        <div className="flex items-start gap-2 px-3 py-2 text-[12px] text-rose bg-rose/10 border border-rose/30 rounded-lg">
          <AlertCircle size={14} className="mt-0.5 shrink-0" /> {error}
        </div>
      )}
      {note && <div className="px-3 py-2 text-[12px] text-sky bg-sky/10 border border-sky/20 rounded-lg">{note}</div>}

      <div className="bg-card border border-ink rounded-xl p-5 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <p className="text-[11px] text-slate-muted mb-1.5 font-medium uppercase tracking-wider">Job title (optional)</p>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Senior Frontend Engineer"
              className="w-full bg-raised border border-ink focus:border-sky/40 outline-none px-3 py-2 rounded-lg text-[13px] text-slate-text placeholder:text-slate-muted/60"
            />
          </div>
          <div>
            <p className="text-[11px] text-slate-muted mb-1.5 font-medium uppercase tracking-wider">Company (optional)</p>
            <input
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="Acme Inc."
              className="w-full bg-raised border border-ink focus:border-sky/40 outline-none px-3 py-2 rounded-lg text-[13px] text-slate-text placeholder:text-slate-muted/60"
            />
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-[11px] text-slate-muted font-medium uppercase tracking-wider">Job description</p>
            <label className="flex items-center gap-1.5 text-[11px] text-sky hover:text-sky/80 cursor-pointer">
              <Upload size={12} /> Upload .txt
              <input type="file" accept=".txt,.md,text/plain" onChange={onFile} className="hidden" />
            </label>
          </div>
          <textarea
            value={jd}
            onChange={(e) => setJd(e.target.value)}
            rows={12}
            placeholder="Paste the full job description here…"
            className="w-full bg-raised border border-ink focus:border-sky/40 outline-none px-3 py-2.5 rounded-lg text-[12px] text-slate-text resize-y"
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={generate}
            disabled={generating || !jd.trim()}
            className="flex items-center gap-2 px-4 py-2 bg-violet-500/10 text-violet-300 border border-violet-500/30 hover:bg-violet-500/20 disabled:opacity-40 rounded-lg text-[13px] font-medium transition-all"
          >
            <Sparkles size={14} /> {generating ? 'Generating…' : resume ? 'Regenerate' : 'Generate résumé'}
          </button>
          <span className="text-[11px] text-slate-muted">One AI call · reframes your real experience for this JD.</span>
        </div>
      </div>

      {resume && (
        <>
          <ChangesReview changes={changes} />
          <div className="border-t border-ink-subtle pt-4">
            <p className="text-[12px] text-slate-muted mb-3">Tailored résumé — edit freely, then download.</p>
            <ResumeFields value={resume} onChange={setResume} />
          </div>
          <div className="flex items-center gap-3 sticky bottom-0 bg-void/80 backdrop-blur py-3">
            <select
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              className="px-2.5 py-2 bg-card border border-ink rounded-md text-[12px] text-slate-text outline-none focus:border-sky/40"
            >
              <option value="classic">Classic</option>
              <option value="modern">Modern</option>
            </select>
            <button
              onClick={download}
              disabled={downloading}
              className="flex items-center gap-2 px-5 py-2.5 bg-emerald/10 text-emerald border border-emerald/30 hover:bg-emerald/20 disabled:opacity-40 rounded-lg text-[13px] font-medium transition-all"
            >
              <Download size={14} /> {downloading ? 'Rendering…' : 'Download PDF'}
            </button>
          </div>
        </>
      )}

      {!resume && (
        <p className="text-[11px] text-slate-muted flex items-center gap-1.5">
          <FileText size={12} /> Tip: keep your base résumé current under the Base résumé tab for the best results.
        </p>
      )}
    </div>
  );
}
