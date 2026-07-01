'use client';

import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { ResumeDoc, ResumeWork, ResumeEducation, ResumeSkill, ResumeProject } from '@/lib/types';

/**
 * Résumé-styled inline editor for a ResumeDoc (ADR 0052). Instead of a stacked form, it
 * renders a résumé-looking "page" — centered name/headline header, section headings, roles
 * with bold company · italic title · dates, and bullet lists — where EVERY piece of text is
 * click-to-edit in place. It approximates the PDF layout (not a pixel match) so the user
 * edits something that reads like their résumé. Controlled: all edits flow through onChange,
 * so nothing is ever "hidden" or lost. Shared by the base-résumé editor, the per-application
 * tailored editor, and the manual "paste a JD" flow.
 */
export default function ResumeFields({ value, onChange }: { value: ResumeDoc; onChange: (next: ResumeDoc) => void }) {
  const d = value;
  function update(next: Partial<ResumeDoc>) {
    onChange({ ...d, ...next });
  }
  function setBasics(key: string, v: string) {
    update({ basics: { ...d.basics, [key]: v } });
  }
  const profiles = d.basics.profiles ?? [];
  function setProfiles(next: { network?: string; url?: string }[]) {
    update({ basics: { ...d.basics, profiles: next } });
  }

  return (
    <div className="rounded-xl border border-ink bg-[#f7f7f4] text-[#1a1a1a] shadow-inner overflow-hidden">
      {/* The "paper". Serif type + generous spacing evoke the printed résumé. */}
      <div className="mx-auto max-w-[820px] px-6 sm:px-10 py-8 font-serif">
        {/* ── Header ─────────────────────────────────────────────────────────── */}
        <header className="text-center pb-4 border-b border-[#ddd]">
          <PaperInline
            block
            value={d.basics.name}
            onChange={(v) => setBasics('name', v)}
            placeholder="Your Name"
            className="text-[26px] font-bold tracking-tight text-center"
          />
          <PaperInline
            block
            value={d.basics.label}
            onChange={(v) => setBasics('label', v)}
            placeholder="Your Headline"
            className="text-[14px] font-semibold text-[#444] text-center mt-0.5"
          />
          <div className="mt-2 flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 text-[12px] text-[#555]">
            <PaperInline value={d.basics.email} onChange={(v) => setBasics('email', v)} placeholder="email" />
            <Dot />
            <PaperInline value={d.basics.phone} onChange={(v) => setBasics('phone', v)} placeholder="phone" />
            <Dot />
            <PaperInline value={d.basics.location} onChange={(v) => setBasics('location', v)} placeholder="location" />
            <Dot />
            <PaperInline value={d.basics.url} onChange={(v) => setBasics('url', v)} placeholder="website" />
          </div>
          {/* Links row */}
          <div className="mt-1.5 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[12px] text-[#0369a1]">
            {profiles.map((p, i) => (
              <span key={i} className="group inline-flex items-center gap-1">
                {i > 0 && <span className="text-[#bbb] mr-1">·</span>}
                <PaperInline
                  value={p.network}
                  onChange={(v) => setProfiles(profiles.map((it, j) => (j === i ? { ...it, network: v } : it)))}
                  placeholder="Label"
                  className="font-medium"
                />
                <span className="text-[#94a3b8]">:</span>
                <PaperInline
                  value={p.url}
                  onChange={(v) => setProfiles(profiles.map((it, j) => (j === i ? { ...it, url: v } : it)))}
                  placeholder="url"
                />
                <button
                  onClick={() => setProfiles(profiles.filter((_, j) => j !== i))}
                  title="Remove link"
                  className="opacity-0 group-hover:opacity-100 text-[#aaa] hover:text-rose transition-opacity"
                >
                  <Trash2 size={11} />
                </button>
              </span>
            ))}
            <AddInline label="+ link" onClick={() => setProfiles([...profiles, { network: '', url: '' }])} />
          </div>
        </header>

        {/* ── Summary ────────────────────────────────────────────────────────── */}
        <SectionHead title="Summary" />
        <PaperText
          value={d.basics.summary}
          onChange={(v) => setBasics('summary', v)}
          placeholder="A 2–3 line professional summary…"
          multiline
          className="text-[12.5px] leading-relaxed text-[#333]"
        />

        {/* ── Experience ─────────────────────────────────────────────────────── */}
        <SectionHead
          title="Experience"
          onAdd={() => update({ work: [{ highlights: [] }, ...d.work] })}
        />
        {d.work.length === 0 && <EmptyLine>No experience yet — click “+” to add a role.</EmptyLine>}
        {d.work.map((w, i) => (
          <Entry
            key={i}
            onRemove={() => update({ work: d.work.filter((_, j) => j !== i) })}
            titleLeft={
              <PaperInline value={w.name} onChange={(v) => update({ work: patch(d.work, i, { name: v }) })} placeholder="Company" className="font-bold text-[13.5px] text-[#1a1a1a]" />
            }
            titleRight={
              <span className="inline-flex items-center gap-1 text-[12px] font-bold text-[#555] whitespace-nowrap">
                <PaperInline value={w.startDate} onChange={(v) => update({ work: patch(d.work, i, { startDate: v }) })} placeholder="Start" className="text-right" />
                <span>–</span>
                <PaperInline value={w.endDate} onChange={(v) => update({ work: patch(d.work, i, { endDate: v }) })} placeholder="End" />
              </span>
            }
            subLeft={
              <PaperInline value={w.position} onChange={(v) => update({ work: patch(d.work, i, { position: v }) })} placeholder="Title" className="italic text-[12.5px] text-[#333]" />
            }
            subRight={
              <PaperInline value={w.location} onChange={(v) => update({ work: patch(d.work, i, { location: v }) })} placeholder="Location" className="italic text-[12px] text-[#666]" />
            }
          >
            <BulletList
              items={w.highlights}
              onChange={(next) => update({ work: patch(d.work, i, { highlights: next }) })}
              placeholder="Describe an accomplishment…"
            />
          </Entry>
        ))}

        {/* ── Education ──────────────────────────────────────────────────────── */}
        <SectionHead title="Education" onAdd={() => update({ education: [{}, ...d.education] })} />
        {d.education.length === 0 && <EmptyLine>No education yet.</EmptyLine>}
        {d.education.map((e, i) => (
          <Entry
            key={i}
            onRemove={() => update({ education: d.education.filter((_, j) => j !== i) })}
            titleLeft={
              <PaperInline value={e.institution} onChange={(v) => update({ education: patch(d.education, i, { institution: v }) })} placeholder="Institution" className="font-bold text-[13.5px] text-[#1a1a1a]" />
            }
            titleRight={
              <span className="inline-flex items-center gap-1 text-[12px] font-bold text-[#555] whitespace-nowrap">
                <PaperInline value={e.startDate} onChange={(v) => update({ education: patch(d.education, i, { startDate: v }) })} placeholder="Start" className="text-right" />
                <span>–</span>
                <PaperInline value={e.endDate} onChange={(v) => update({ education: patch(d.education, i, { endDate: v }) })} placeholder="End" />
              </span>
            }
            subLeft={
              <span className="italic text-[12.5px] text-[#333] inline-flex items-center gap-1">
                <PaperInline value={e.studyType} onChange={(v) => update({ education: patch(d.education, i, { studyType: v }) })} placeholder="Degree" />
                <PaperInline value={e.area} onChange={(v) => update({ education: patch(d.education, i, { area: v }) })} placeholder="Field of study" />
              </span>
            }
          />
        ))}

        {/* ── Skills ─────────────────────────────────────────────────────────── */}
        <SectionHead title="Skills" onAdd={() => update({ skills: [...d.skills, { name: '', keywords: [] }] })} />
        {d.skills.length === 0 && <EmptyLine>No skills yet.</EmptyLine>}
        <div className="space-y-1">
          {d.skills.map((s, i) => (
            <div key={i} className="group flex items-baseline gap-1.5 text-[12.5px] leading-relaxed">
              <PaperInline value={s.name} onChange={(v) => update({ skills: patch(d.skills, i, { name: v }) })} placeholder="Group" className="font-bold text-[#1a1a1a] whitespace-nowrap" />
              <span className="text-[#1a1a1a] font-bold">:</span>
              <SkillKeywords
                keywords={s.keywords || []}
                onChange={(kw) => update({ skills: patch(d.skills, i, { keywords: kw }) })}
              />
              <button
                onClick={() => update({ skills: d.skills.filter((_, j) => j !== i) })}
                title="Remove group"
                className="opacity-0 group-hover:opacity-100 text-[#bbb] hover:text-rose transition-opacity shrink-0 self-start mt-0.5"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>

        {/* ── Projects ───────────────────────────────────────────────────────── */}
        <SectionHead title="Projects" onAdd={() => update({ projects: [{ highlights: [] }, ...d.projects] })} />
        {d.projects.length === 0 && <EmptyLine>No projects yet.</EmptyLine>}
        {d.projects.map((p, i) => (
          <Entry
            key={i}
            onRemove={() => update({ projects: d.projects.filter((_, j) => j !== i) })}
            titleLeft={
              <PaperInline value={p.name} onChange={(v) => update({ projects: patch(d.projects, i, { name: v }) })} placeholder="Project name" className="font-bold text-[13.5px] text-[#1a1a1a]" />
            }
            titleRight={
              <PaperInline value={p.url} onChange={(v) => update({ projects: patch(d.projects, i, { url: v }) })} placeholder="url" className="text-[12px] text-[#0369a1]" />
            }
            subLeft={
              <PaperInline value={p.description} onChange={(v) => update({ projects: patch(d.projects, i, { description: v }) })} placeholder="Short description" className="italic text-[12.5px] text-[#333]" />
            }
          >
            <BulletList
              items={p.highlights}
              onChange={(next) => update({ projects: patch(d.projects, i, { highlights: next }) })}
              placeholder="A project highlight…"
            />
          </Entry>
        ))}
      </div>
    </div>
  );
}

// ── shared helpers ───────────────────────────────────────────────────────────
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

// ── résumé-styled building blocks ────────────────────────────────────────────

/** A section heading with an underline, matching the PDF's <h2>, plus an inline "+" add. */
function SectionHead({ title, onAdd }: { title: string; onAdd?: () => void }) {
  return (
    <div className="flex items-center gap-2 mt-5 mb-2 border-b border-[#999] pb-0.5">
      <h2 className="text-[13px] font-bold uppercase tracking-wider text-[#1a1a1a]">{title}</h2>
      {onAdd && (
        <button
          onClick={onAdd}
          title={`Add ${title.toLowerCase()}`}
          className="ml-auto flex items-center gap-0.5 text-[11px] font-sans text-[#0369a1] hover:text-[#0284c7] transition-colors"
        >
          <Plus size={13} />
        </button>
      )}
    </div>
  );
}

/** One résumé entry: a two-column head (title left / dates right), an optional sub line,
 *  and children (bullets). A remove control appears on hover in the left gutter. */
function Entry({
  titleLeft,
  titleRight,
  subLeft,
  subRight,
  children,
  onRemove,
}: {
  titleLeft: React.ReactNode;
  titleRight?: React.ReactNode;
  subLeft?: React.ReactNode;
  subRight?: React.ReactNode;
  children?: React.ReactNode;
  onRemove: () => void;
}) {
  return (
    <div className="group relative mt-2.5 first:mt-1.5">
      {/* hover gutter with remove */}
      <button
        onClick={onRemove}
        title="Remove"
        className="absolute -left-6 top-0.5 opacity-0 group-hover:opacity-100 text-[#bbb] hover:text-rose transition-opacity hidden sm:block"
      >
        <Trash2 size={13} />
      </button>
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">{titleLeft}</div>
        {titleRight}
      </div>
      {(subLeft || subRight) && (
        <div className="flex items-baseline justify-between gap-3 mt-0.5">
          <div className="min-w-0">{subLeft}</div>
          {subRight}
        </div>
      )}
      {children && <div className="mt-1">{children}</div>}
      {/* mobile remove (no left gutter) */}
      <button
        onClick={onRemove}
        title="Remove"
        className="sm:hidden mt-1 inline-flex items-center gap-1 text-[11px] text-[#bbb] hover:text-rose font-sans"
      >
        <Trash2 size={11} /> Remove
      </button>
    </div>
  );
}

/** A bulleted list where each line is an inline-editable "•" item. Editing writes the raw
 *  value back to its position (so a bullet you're mid-typing is never dropped); a bullet is
 *  only removed by the explicit trash button. "+ bullet" appends a blank line to type into.
 *  An always-present trailing blank row lets you start a new bullet without clicking "+". */
function BulletList({ items, onChange, placeholder }: { items: string[]; onChange: (next: string[]) => void; placeholder?: string }) {
  // Show the real items plus one trailing blank row to type the next bullet into.
  const rows = [...items, ''];
  function setRow(i: number, v: string) {
    const next = i < items.length ? items.map((it, j) => (j === i ? v : it)) : [...items, v];
    onChange(next); // keep blanks while typing; splitLines/caller trims on save
  }
  return (
    <ul className="space-y-0.5">
      {rows.map((h, i) => (
        <li key={i} className="group/bullet flex gap-2 text-[12px] leading-relaxed text-[#222]">
          <span className={`select-none mt-[1px] ${i < items.length ? 'text-[#666]' : 'text-[#ccc]'}`}>•</span>
          <PaperText value={h} onChange={(v) => setRow(i, v)} placeholder={i === items.length ? placeholder : undefined} multiline className="flex-1" />
          {i < items.length && (
            <button
              onClick={() => onChange(items.filter((_, j) => j !== i))}
              title="Remove bullet"
              className="opacity-0 group-hover/bullet:opacity-100 text-[#ccc] hover:text-rose transition-opacity shrink-0 self-start mt-0.5"
            >
              <Trash2 size={11} />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Inline single-line editable text: reads like plain résumé text, gets a subtle
 *  highlight on hover/focus so it's discoverable as editable. Auto-sizes to content. */
function PaperInline({
  value,
  onChange,
  placeholder,
  className = '',
  block = false,
}: {
  value?: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  /** Full-width (used for the centered header name/headline); otherwise auto-sized to content. */
  block?: boolean;
}) {
  return (
    <input
      value={value ?? ''}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      {...(block ? {} : { size: Math.max((value?.length || placeholder?.length || 4) + 2, 3) })}
      className={`bg-transparent outline-none rounded px-1 -mx-1 py-0 hover:bg-black/[0.04] focus:bg-sky/10 focus:ring-1 focus:ring-sky/40 transition-colors placeholder:text-[#aaa] placeholder:italic ${block ? 'w-full' : 'max-w-full'} ${className}`}
    />
  );
}

/** Inline multi-line editable text (summary, bullets, skills): a textarea that grows with
 *  its content and looks like flowing résumé text until focused. */
function PaperText({
  value,
  onChange,
  placeholder,
  multiline,
  className = '',
}: {
  value?: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  className?: string;
}) {
  if (!multiline) {
    return <PaperInline value={value} onChange={onChange} placeholder={placeholder} className={className} />;
  }
  return (
    <textarea
      value={value ?? ''}
      placeholder={placeholder}
      onChange={(e) => {
        onChange(e.target.value);
        // auto-grow
        e.target.style.height = 'auto';
        e.target.style.height = `${e.target.scrollHeight}px`;
      }}
      rows={1}
      ref={(el) => {
        if (el) {
          el.style.height = 'auto';
          el.style.height = `${el.scrollHeight}px`;
        }
      }}
      className={`w-full bg-transparent outline-none rounded px-1 -mx-1 py-0 resize-none overflow-hidden hover:bg-black/[0.04] focus:bg-sky/10 focus:ring-1 focus:ring-sky/40 transition-colors placeholder:text-[#aaa] placeholder:italic ${className}`}
    />
  );
}

/**
 * Comma-separated skill keywords, edited as raw text so a trailing comma/space you're
 * typing isn't eaten by an eager split. It keeps a local draft while focused and only
 * commits the split array on blur; when not focused it mirrors the parent value.
 */
function SkillKeywords({ keywords, onChange }: { keywords: string[]; onChange: (kw: string[]) => void }) {
  const joined = keywords.join(', ');
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? joined;
  return (
    <textarea
      value={shown}
      placeholder="Skill, skill, skill…"
      rows={1}
      onFocus={() => setDraft(joined)}
      onChange={(e) => {
        setDraft(e.target.value);
        e.target.style.height = 'auto';
        e.target.style.height = `${e.target.scrollHeight}px`;
      }}
      onBlur={() => {
        onChange(splitList(draft ?? ''));
        setDraft(null);
      }}
      ref={(el) => {
        if (el) {
          el.style.height = 'auto';
          el.style.height = `${el.scrollHeight}px`;
        }
      }}
      className="flex-1 text-[#333] bg-transparent outline-none rounded px-1 -mx-1 py-0 resize-none overflow-hidden hover:bg-black/[0.04] focus:bg-sky/10 focus:ring-1 focus:ring-sky/40 transition-colors placeholder:text-[#aaa] placeholder:italic"
    />
  );
}

/** A small dot separator for the contact line. */
function Dot() {
  return <span className="text-[#bbb]">·</span>;
}

/** A subtle sans-serif "+ add" affordance used inline within the paper. */
function AddInline({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="font-sans text-[11px] text-[#0369a1] hover:text-[#0284c7] hover:underline transition-colors"
    >
      {label}
    </button>
  );
}

/** An italic muted placeholder line shown when a section has no entries. */
function EmptyLine({ children }: { children: React.ReactNode }) {
  return <p className="text-[12px] italic text-[#999] mt-1">{children}</p>;
}
