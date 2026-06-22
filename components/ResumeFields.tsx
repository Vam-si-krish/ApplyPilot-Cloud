'use client';

import { Plus, Trash2 } from 'lucide-react';
import type { ResumeDoc, ResumeWork, ResumeEducation, ResumeSkill, ResumeProject } from '@/lib/types';

/**
 * Structured editor for a ResumeDoc (ADR 0024). Controlled — give it the doc and
 * an onChange. Shared by the base-résumé editor and the per-application tailored
 * editor. Bullets/keywords use one-per-line / comma textareas for fast editing.
 */
export default function ResumeFields({ value, onChange }: { value: ResumeDoc; onChange: (next: ResumeDoc) => void }) {
  const d = value;
  function update(next: Partial<ResumeDoc>) {
    onChange({ ...d, ...next });
  }
  function setBasics(key: string, v: string) {
    update({ basics: { ...d.basics, [key]: v } });
  }

  return (
    <div className="space-y-5">
      {/* Basics */}
      <Section title="Basics">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input label="Full name" value={d.basics.name} onChange={(v) => setBasics('name', v)} />
          <Input label="Headline" value={d.basics.label} onChange={(v) => setBasics('label', v)} placeholder="Senior Frontend Engineer" />
          <Input label="Email" value={d.basics.email} onChange={(v) => setBasics('email', v)} />
          <Input label="Phone" value={d.basics.phone} onChange={(v) => setBasics('phone', v)} />
          <Input label="Location" value={d.basics.location} onChange={(v) => setBasics('location', v)} placeholder="Boston, MA" />
          <Input label="Website / portfolio" value={d.basics.url} onChange={(v) => setBasics('url', v)} />
        </div>
        <TextArea label="Summary" value={d.basics.summary} onChange={(v) => setBasics('summary', v)} rows={3} />
      </Section>

      {/* Skills */}
      <Section title="Skills" onAdd={() => update({ skills: [...d.skills, { name: '', keywords: [] }] })} addLabel="Add skill group">
        {d.skills.length === 0 && <Empty>No skill groups.</Empty>}
        {d.skills.map((s, i) => (
          <Row key={i} onRemove={() => update({ skills: d.skills.filter((_, j) => j !== i) })}>
            <Input label="Group" value={s.name} onChange={(v) => update({ skills: patch(d.skills, i, { name: v }) })} placeholder="Frontend" />
            <TextArea
              label="Skills (comma-separated)"
              value={s.keywords.join(', ')}
              onChange={(v) => update({ skills: patch(d.skills, i, { keywords: splitList(v) }) })}
              rows={2}
            />
          </Row>
        ))}
      </Section>

      {/* Work */}
      <Section title="Experience" onAdd={() => update({ work: [...d.work, { highlights: [] }] })} addLabel="Add role">
        {d.work.length === 0 && <Empty>No experience entries.</Empty>}
        {d.work.map((w, i) => (
          <Row key={i} onRemove={() => update({ work: d.work.filter((_, j) => j !== i) })}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input label="Company" value={w.name} onChange={(v) => update({ work: patch(d.work, i, { name: v }) })} />
              <Input label="Title" value={w.position} onChange={(v) => update({ work: patch(d.work, i, { position: v }) })} />
              <Input label="Location" value={w.location} onChange={(v) => update({ work: patch(d.work, i, { location: v }) })} />
              <div className="grid grid-cols-2 gap-3">
                <Input label="Start" value={w.startDate} onChange={(v) => update({ work: patch(d.work, i, { startDate: v }) })} placeholder="2021" />
                <Input label="End" value={w.endDate} onChange={(v) => update({ work: patch(d.work, i, { endDate: v }) })} placeholder="Present" />
              </div>
            </div>
            <TextArea
              label="Highlights (one bullet per line)"
              value={w.highlights.join('\n')}
              onChange={(v) => update({ work: patch(d.work, i, { highlights: splitLines(v) }) })}
              rows={5}
              mono
            />
          </Row>
        ))}
      </Section>

      {/* Education */}
      <Section title="Education" onAdd={() => update({ education: [...d.education, {}] })} addLabel="Add education">
        {d.education.length === 0 && <Empty>No education entries.</Empty>}
        {d.education.map((e, i) => (
          <Row key={i} onRemove={() => update({ education: d.education.filter((_, j) => j !== i) })}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input label="Institution" value={e.institution} onChange={(v) => update({ education: patch(d.education, i, { institution: v }) })} />
              <Input label="Degree" value={e.studyType} onChange={(v) => update({ education: patch(d.education, i, { studyType: v }) })} placeholder="MS" />
              <Input label="Field of study" value={e.area} onChange={(v) => update({ education: patch(d.education, i, { area: v }) })} />
              <div className="grid grid-cols-2 gap-3">
                <Input label="Start" value={e.startDate} onChange={(v) => update({ education: patch(d.education, i, { startDate: v }) })} />
                <Input label="End" value={e.endDate} onChange={(v) => update({ education: patch(d.education, i, { endDate: v }) })} />
              </div>
            </div>
          </Row>
        ))}
      </Section>

      {/* Projects */}
      <Section title="Projects" onAdd={() => update({ projects: [...d.projects, { highlights: [] }] })} addLabel="Add project">
        {d.projects.length === 0 && <Empty>No projects.</Empty>}
        {d.projects.map((p, i) => (
          <Row key={i} onRemove={() => update({ projects: d.projects.filter((_, j) => j !== i) })}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input label="Name" value={p.name} onChange={(v) => update({ projects: patch(d.projects, i, { name: v }) })} />
              <Input label="URL" value={p.url} onChange={(v) => update({ projects: patch(d.projects, i, { url: v }) })} />
            </div>
            <TextArea label="Description" value={p.description} onChange={(v) => update({ projects: patch(d.projects, i, { description: v }) })} rows={2} />
            <TextArea
              label="Highlights (one per line)"
              value={p.highlights.join('\n')}
              onChange={(v) => update({ projects: patch(d.projects, i, { highlights: splitLines(v) }) })}
              rows={3}
              mono
            />
          </Row>
        ))}
      </Section>
    </div>
  );
}

// ── shared helpers + inputs ──────────────────────────────────────────────────
type Listable = ResumeWork | ResumeEducation | ResumeSkill | ResumeProject;
export function patch<T extends Listable>(list: T[], i: number, p: Partial<T>): T[] {
  return list.map((item, j) => (j === i ? { ...item, ...p } : item));
}
export function splitLines(v: string): string[] {
  return v.split(/\r?\n/).map((s) => s.replace(/^[•\-*]\s*/, '').trim()).filter(Boolean);
}
export function splitList(v: string): string[] {
  return v.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
}

function Section({ title, children, onAdd, addLabel }: { title: string; children: React.ReactNode; onAdd?: () => void; addLabel?: string }) {
  return (
    <div className="bg-card border border-ink rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <p className="text-[12px] font-semibold text-slate-muted uppercase tracking-wider font-display">{title}</p>
        {onAdd && (
          <button onClick={onAdd} className="flex items-center gap-1 text-[12px] text-sky hover:text-sky/80">
            <Plus size={13} /> {addLabel}
          </button>
        )}
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function Row({ children, onRemove }: { children: React.ReactNode; onRemove: () => void }) {
  return (
    <div className="relative border border-ink-subtle rounded-lg p-4 space-y-3 bg-raised/40">
      <button onClick={onRemove} title="Remove" className="absolute top-2 right-2 text-slate-muted hover:text-rose">
        <Trash2 size={14} />
      </button>
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-[12px] text-slate-muted italic">{children}</p>;
}

function Input({ label, value, onChange, placeholder }: { label: string; value?: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <p className="text-[11px] text-slate-muted mb-1 font-medium uppercase tracking-wider">{label}</p>
      <input
        value={value ?? ''}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-raised border border-ink focus:border-sky/40 outline-none px-3 py-2 rounded-lg text-[13px] text-slate-text transition-colors placeholder:text-slate-muted/60"
      />
    </div>
  );
}

function TextArea({ label, value, onChange, rows = 3, mono }: { label: string; value?: string; onChange: (v: string) => void; rows?: number; mono?: boolean }) {
  return (
    <div>
      <p className="text-[11px] text-slate-muted mb-1 font-medium uppercase tracking-wider">{label}</p>
      <textarea
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        className={`w-full bg-raised border border-ink focus:border-sky/40 outline-none px-3 py-2 rounded-lg text-[12px] text-slate-text resize-y ${mono ? 'font-mono' : ''}`}
      />
    </div>
  );
}
