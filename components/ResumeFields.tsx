'use client';

import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type {
  ResumeDoc,
  ResumeWork,
  ResumeEducation,
  ResumeSkill,
  ResumeProject,
  ResumeCustomItem,
} from '@/lib/types';
import { ResumePaperFrame, ResumeSectionHeading } from '@/components/ResumePaper';

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
  const customSections = d.customSections ?? [];
  function updateCustomSection(sectionIndex: number, next: Partial<(typeof customSections)[number]>) {
    update({
      customSections: customSections.map((section, i) => (i === sectionIndex ? { ...section, ...next } : section)),
    });
  }
  function updateCustomItem(sectionIndex: number, itemIndex: number, next: Partial<ResumeCustomItem>) {
    const section = customSections[sectionIndex];
    if (!section) return;
    updateCustomSection(sectionIndex, { items: patch(section.items, itemIndex, next) });
  }

  return (
    <ResumePaperFrame>
        {/* ── Header ─────────────────────────────────────────────────────────── */}
        <header className="mb-1 text-center">
          <PaperInline
            block
            value={d.basics.name}
            onChange={(v) => setBasics('name', v)}
            placeholder="Your Name"
            className="text-center text-[25px] font-bold leading-tight tracking-tight text-[#1a1a1a] sm:text-[28px]"
          />
          <PaperInline
            block
            value={d.basics.label}
            onChange={(v) => setBasics('label', v)}
            placeholder="Your Headline"
            className="mt-0.5 text-center text-[13px] font-semibold text-[#444] sm:text-[14px]"
          />
          <div className="mt-2 flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 text-[11.5px] leading-relaxed text-[#444] sm:text-[12px]">
            <PaperInline value={d.basics.email} onChange={(v) => setBasics('email', v)} placeholder="email" />
            <Dot />
            <PaperInline value={d.basics.phone} onChange={(v) => setBasics('phone', v)} placeholder="phone" />
            <Dot />
            <PaperInline value={d.basics.location} onChange={(v) => setBasics('location', v)} placeholder="location" />
            <Dot />
            <PaperInline value={d.basics.url} onChange={(v) => setBasics('url', v)} placeholder="website" />
          </div>
          {/* Links row */}
          <div className="mt-1 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[11.5px] text-[#1f4e79] sm:text-[12px]">
            {profiles.map((p, i) => (
              <span key={i} className="group inline-flex items-center gap-1">
                {i > 0 && <span className="mr-1 text-[#9ca3af]">·</span>}
                <PaperInline
                  value={p.network}
                  onChange={(v) => setProfiles(profiles.map((it, j) => (j === i ? { ...it, network: v } : it)))}
                  placeholder="Label"
                  className="font-medium"
                />
                <span className="text-[#6b7280]">:</span>
                <PaperInline
                  value={p.url}
                  onChange={(v) => setProfiles(profiles.map((it, j) => (j === i ? { ...it, url: v } : it)))}
                  placeholder="url"
                />
                <button
                  onClick={() => setProfiles(profiles.filter((_, j) => j !== i))}
                  title="Remove link"
                  className="text-[#9ca3af] opacity-0 transition-opacity hover:text-[#b42318] group-hover:opacity-100"
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
          className="text-[12.5px] leading-[1.55] text-[#1a1a1a] sm:text-[13px]"
        />

        {/* ── Skills — same order and title as the downloaded PDF ───────────── */}
        <SectionHead title="Technical Skills" onAdd={() => update({ skills: [...d.skills, { name: '', keywords: [] }] })} />
        {d.skills.length === 0 && <EmptyLine>No skills yet.</EmptyLine>}
        <div className="space-y-1">
          {d.skills.map((s, i) => (
            <div key={i} className="group flex items-start gap-1.5 text-[12.5px] leading-[1.5] text-[#1a1a1a] sm:text-[13px]">
              <span className="mt-[1px] select-none text-[#1a1a1a]">•</span>
              <PaperInline value={s.name} onChange={(v) => update({ skills: patch(d.skills, i, { name: v }) })} placeholder="Group" className="whitespace-nowrap font-bold text-[#1a1a1a]" />
              <span className="font-bold text-[#1a1a1a]">:</span>
              <SkillKeywords
                keywords={s.keywords || []}
                onChange={(kw) => update({ skills: patch(d.skills, i, { keywords: kw }) })}
              />
              <button
                onClick={() => update({ skills: d.skills.filter((_, j) => j !== i) })}
                title="Remove group"
                className="mt-0.5 shrink-0 text-[#9ca3af] opacity-0 transition-opacity hover:text-[#b42318] group-hover:opacity-100"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>

        {/* ── Experience ─────────────────────────────────────────────────────── */}
        <SectionHead
          title="Professional Experience"
          onAdd={() => update({ work: [{ highlights: [] }, ...d.work] })}
        />
        {d.work.length === 0 && <EmptyLine>No experience yet — click “+” to add a role.</EmptyLine>}
        {d.work.map((w, i) => (
          <Entry
            key={i}
            onRemove={() => update({ work: d.work.filter((_, j) => j !== i) })}
            titleLeft={
              <PaperInline value={w.name} onChange={(v) => update({ work: patch(d.work, i, { name: v }) })} placeholder="Company" className="text-[13.5px] font-bold text-[#1a1a1a] sm:text-[14px]" />
            }
            titleRight={
              <span className="inline-flex items-center gap-1 whitespace-nowrap text-[12px] font-bold text-[#444] sm:text-[12.5px]">
                <PaperInline value={w.startDate} onChange={(v) => update({ work: patch(d.work, i, { startDate: v }) })} placeholder="Start" className="text-right" />
                <span>–</span>
                <PaperInline value={w.endDate} onChange={(v) => update({ work: patch(d.work, i, { endDate: v }) })} placeholder="End" />
              </span>
            }
            subLeft={
              <PaperInline value={w.position} onChange={(v) => update({ work: patch(d.work, i, { position: v }) })} placeholder="Title" className="text-[12.5px] italic text-[#1a1a1a] sm:text-[13px]" />
            }
            subRight={
              <PaperInline value={w.location} onChange={(v) => update({ work: patch(d.work, i, { location: v }) })} placeholder="Location" className="text-[12px] italic text-[#444] sm:text-[12.5px]" />
            }
          >
            <BulletList
              items={w.highlights}
              onChange={(next) => update({ work: patch(d.work, i, { highlights: next }) })}
              placeholder="Describe an accomplishment…"
            />
          </Entry>
        ))}

        {/* ── Projects ───────────────────────────────────────────────────────── */}
        <SectionHead title="Projects" onAdd={() => update({ projects: [{ highlights: [] }, ...d.projects] })} />
        {d.projects.length === 0 && <EmptyLine>No projects yet.</EmptyLine>}
        {d.projects.map((p, i) => (
          <Entry
            key={i}
            onRemove={() => update({ projects: d.projects.filter((_, j) => j !== i) })}
            titleLeft={
              <PaperInline value={p.name} onChange={(v) => update({ projects: patch(d.projects, i, { name: v }) })} placeholder="Project name" className="text-[13.5px] font-bold text-[#1a1a1a] sm:text-[14px]" />
            }
            titleRight={
              <PaperInline value={p.url} onChange={(v) => update({ projects: patch(d.projects, i, { url: v }) })} placeholder="url" className="text-[12px] text-[#1f4e79]" />
            }
            subLeft={
              <PaperInline value={p.description} onChange={(v) => update({ projects: patch(d.projects, i, { description: v }) })} placeholder="Short description" className="text-[12.5px] italic text-[#1a1a1a] sm:text-[13px]" />
            }
          >
            <BulletList
              items={p.highlights}
              onChange={(next) => update({ projects: patch(d.projects, i, { highlights: next }) })}
              placeholder="A project highlight…"
            />
          </Entry>
        ))}

        {/* ── User-defined sections (ADR 0085) ─────────────────────────────── */}
        {customSections.map((section, sectionIndex) => (
          <div key={sectionIndex}>
            <ResumeSectionHeading
              title={
                <PaperInline
                  block
                  value={section.title}
                  onChange={(title) => updateCustomSection(sectionIndex, { title })}
                  placeholder="Section title"
                  className="text-[13px] font-bold uppercase tracking-[0.055em] text-[#1a1a1a] sm:text-[14px]"
                />
              }
              action={
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => updateCustomSection(sectionIndex, { items: [...section.items, { highlights: [] }] })}
                    title={`Add entry to ${section.title || 'custom section'}`}
                    className="flex items-center gap-1 rounded-md px-1.5 py-0.5 font-sans text-[11px] font-medium text-[#1f4e79] transition-colors hover:bg-[#e8f1f8]"
                  >
                    <Plus size={13} /> Entry
                  </button>
                  <button
                    onClick={() => update({ customSections: customSections.filter((_, i) => i !== sectionIndex) })}
                    title="Remove custom section"
                    className="rounded-md p-1 text-[#9ca3af] transition-colors hover:bg-[#fee2e2] hover:text-[#b42318]"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              }
            />
            {section.items.length === 0 && <EmptyLine>No entries yet — click “+ entry” to add one.</EmptyLine>}
            {section.items.map((item, itemIndex) => (
              <Entry
                key={itemIndex}
                onRemove={() => updateCustomSection(sectionIndex, { items: section.items.filter((_, i) => i !== itemIndex) })}
                titleLeft={
                  <PaperInline
                    value={item.name}
                    onChange={(name) => updateCustomItem(sectionIndex, itemIndex, { name })}
                    placeholder="Entry name"
                    className="text-[13.5px] font-bold text-[#1a1a1a] sm:text-[14px]"
                  />
                }
                titleRight={
                  <PaperInline
                    value={item.date}
                    onChange={(date) => updateCustomItem(sectionIndex, itemIndex, { date })}
                    placeholder="Date"
                    className="text-right text-[12px] font-bold text-[#444] sm:text-[12.5px]"
                  />
                }
                subLeft={
                  <PaperInline
                    value={item.description}
                    onChange={(description) => updateCustomItem(sectionIndex, itemIndex, { description })}
                    placeholder="Role, issuer, organization, or description"
                    className="text-[12.5px] italic text-[#1a1a1a] sm:text-[13px]"
                  />
                }
                subRight={
                  <PaperInline
                    value={item.location}
                    onChange={(location) => updateCustomItem(sectionIndex, itemIndex, { location })}
                    placeholder="Location"
                    className="text-right text-[12px] italic text-[#444] sm:text-[12.5px]"
                  />
                }
              >
                <div className="mb-1 text-[11px] text-[#1f4e79]">
                  <PaperInline
                    value={item.url}
                    onChange={(url) => updateCustomItem(sectionIndex, itemIndex, { url })}
                    placeholder="Link (optional)"
                  />
                </div>
                <BulletList
                  items={item.highlights}
                  onChange={(highlights) => updateCustomItem(sectionIndex, itemIndex, { highlights })}
                  placeholder="Add supporting detail…"
                />
              </Entry>
            ))}
          </div>
        ))}

        <button
          onClick={() =>
            update({
              customSections: [
                ...customSections,
                { title: 'Additional Experience', items: [{ highlights: [] }] },
              ],
            })
          }
          className="mt-5 w-full rounded-lg border border-dashed border-[#9ca3af] px-4 py-3 text-left font-sans transition-colors hover:border-[#1f4e79] hover:bg-[#f3f7fa]"
        >
          <span className="flex items-center gap-2 text-[12px] font-medium text-[#1f4e79]"><Plus size={14} /> Add custom section</span>
          <span className="mt-0.5 block text-[11px] text-[#6b7280]">Additional Experience, Certifications, Leadership, Publications, Awards, or anything else you need.</span>
        </button>

        {/* ── Education — degree/institution order mirrors the PDF ──────────── */}
        <SectionHead title="Education" onAdd={() => update({ education: [{}, ...d.education] })} />
        {d.education.length === 0 && <EmptyLine>No education yet.</EmptyLine>}
        {d.education.map((e, i) => (
          <Entry
            key={i}
            onRemove={() => update({ education: d.education.filter((_, j) => j !== i) })}
            titleLeft={
              <span className="inline-flex flex-wrap items-center gap-x-1 text-[13.5px] font-bold text-[#1a1a1a] sm:text-[14px]">
                <PaperInline value={e.studyType} onChange={(v) => update({ education: patch(d.education, i, { studyType: v }) })} placeholder="Degree" />
                <PaperInline value={e.area} onChange={(v) => update({ education: patch(d.education, i, { area: v }) })} placeholder="Field of study" />
              </span>
            }
            titleRight={
              <span className="inline-flex items-center gap-1 whitespace-nowrap text-[12px] font-bold text-[#444] sm:text-[12.5px]">
                <PaperInline value={e.startDate} onChange={(v) => update({ education: patch(d.education, i, { startDate: v }) })} placeholder="Start" className="text-right" />
                <span>–</span>
                <PaperInline value={e.endDate} onChange={(v) => update({ education: patch(d.education, i, { endDate: v }) })} placeholder="End" />
              </span>
            }
            subLeft={
              <PaperInline value={e.institution} onChange={(v) => update({ education: patch(d.education, i, { institution: v }) })} placeholder="Institution" className="text-[12.5px] italic text-[#444] sm:text-[13px]" />
            }
          />
        ))}
    </ResumePaperFrame>
  );
}

// ── shared helpers ───────────────────────────────────────────────────────────
type Listable = ResumeWork | ResumeEducation | ResumeSkill | ResumeProject | ResumeCustomItem;
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
    <ResumeSectionHeading
      title={title}
      action={onAdd ? (
        <button
          onClick={onAdd}
          title={`Add ${title.toLowerCase()}`}
          className="flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-sans text-[11px] font-medium text-[#1f4e79] transition-colors hover:bg-[#e8f1f8] hover:text-[#12395a]"
        >
          <Plus size={13} /> Add
        </button>
      ) : undefined}
    />
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
    <div className="group relative mt-3 first:mt-1.5">
      {/* hover gutter with remove */}
      <button
        onClick={onRemove}
        title="Remove"
        className="absolute -left-6 top-0.5 hidden text-[#9ca3af] opacity-0 transition-opacity hover:text-[#b42318] group-hover:opacity-100 sm:block"
      >
        <Trash2 size={13} />
      </button>
      <div className="flex flex-col items-start gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
        <div className="min-w-0">{titleLeft}</div>
        {titleRight ? <div className="shrink-0">{titleRight}</div> : null}
      </div>
      {(subLeft || subRight) && (
        <div className="mt-0.5 flex flex-col items-start gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
          <div className="min-w-0">{subLeft}</div>
          {subRight ? <div className="shrink-0">{subRight}</div> : null}
        </div>
      )}
      {children && <div className="mt-1">{children}</div>}
      {/* mobile remove (no left gutter) */}
      <button
        onClick={onRemove}
        title="Remove"
        className="mt-1 inline-flex items-center gap-1 font-sans text-[11px] text-[#9ca3af] hover:text-[#b42318] sm:hidden"
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
    <ul className="space-y-1">
      {rows.map((h, i) => (
        <li key={i} className="group/bullet flex gap-2 text-[12.5px] leading-[1.5] text-[#1a1a1a] sm:text-[13px]">
          <span className={`mt-[1px] select-none ${i < items.length ? 'text-[#1a1a1a]' : 'text-[#9ca3af]'}`}>•</span>
          <PaperText value={h} onChange={(v) => setRow(i, v)} placeholder={i === items.length ? placeholder : undefined} multiline className="flex-1 text-[#1a1a1a]" />
          {i < items.length && (
            <button
              onClick={() => onChange(items.filter((_, j) => j !== i))}
              title="Remove bullet"
              className="mt-0.5 shrink-0 self-start text-[#9ca3af] opacity-0 transition-opacity hover:text-[#b42318] group-hover/bullet:opacity-100"
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
      className={`-mx-1 rounded bg-transparent px-1 py-0 outline-none transition-colors hover:bg-[#eff6ff] focus:bg-[#e8f1f8] focus:ring-1 focus:ring-[#1f4e79]/40 placeholder:text-[#9ca3af] placeholder:italic ${block ? 'w-full' : 'max-w-full'} ${className}`}
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
      className={`-mx-1 w-full resize-none overflow-hidden rounded bg-transparent px-1 py-0 outline-none transition-colors hover:bg-[#eff6ff] focus:bg-[#e8f1f8] focus:ring-1 focus:ring-[#1f4e79]/40 placeholder:text-[#9ca3af] placeholder:italic ${className}`}
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
      className="-mx-1 flex-1 resize-none overflow-hidden rounded bg-transparent px-1 py-0 text-[#1a1a1a] outline-none transition-colors hover:bg-[#eff6ff] focus:bg-[#e8f1f8] focus:ring-1 focus:ring-[#1f4e79]/40 placeholder:text-[#9ca3af] placeholder:italic"
    />
  );
}

/** A small dot separator for the contact line. */
function Dot() {
  return <span className="text-[#9ca3af]">·</span>;
}

/** A subtle sans-serif "+ add" affordance used inline within the paper. */
function AddInline({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="font-sans text-[11px] font-medium text-[#1f4e79] transition-colors hover:text-[#12395a] hover:underline"
    >
      {label}
    </button>
  );
}

/** An italic muted placeholder line shown when a section has no entries. */
function EmptyLine({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 text-[12px] italic text-[#6b7280]">{children}</p>;
}
