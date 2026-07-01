'use client';

import { diffWords } from 'diff';
import type { ResumeDoc, ResumeWork, ResumeSkill, ResumeProject } from '@/lib/types';

/**
 * Read-only "what tailoring changed" view (ADR 0053). Renders the tailored résumé in the
 * same paper layout as the editor, but every text field is shown as a GitHub-style word
 * diff against the matching field in the BASE résumé: words the tailoring ADDED are green,
 * words it REMOVED are red strike-through. Verifiable facts (company/title/dates/education)
 * are anchored to the base by tailoring, so they rarely differ — the diff focuses attention
 * on the summary, bullets, and skills the AI actually rewrote.
 *
 * Matching: the tailor prompt copies each role/project "name" from the base and keeps the
 * SAME order + count, so we match a tailored entry to its base entry by name (falling back
 * to index). A tailored entry with no base match is treated as fully added.
 */
export default function ResumeDiff({ base, tailored }: { base: ResumeDoc | null; tailored: ResumeDoc }) {
  const b = base;
  return (
    <div className="rounded-xl border border-ink bg-card text-[#e2e8f0] overflow-hidden">
      <div className="mx-auto max-w-[820px] px-6 sm:px-10 py-8 font-serif">
        {/* Legend */}
        <div className="flex items-center justify-center gap-4 mb-4 text-[11px] font-sans">
          <span className="inline-flex items-center gap-1.5 text-emerald">
            <span className="inline-block w-3 h-3 rounded-sm bg-emerald/25 border border-emerald/50" /> Added by tailoring
          </span>
          <span className="inline-flex items-center gap-1.5 text-rose">
            <span className="inline-block w-3 h-3 rounded-sm bg-rose/25 border border-rose/50" /> Removed from base
          </span>
        </div>

        {/* Header — facts are anchored, so show plain (no diff noise). */}
        <header className="text-center pb-4 border-b border-[#1e1e38]">
          <div className="text-[26px] font-bold tracking-tight">{tailored.basics.name || '—'}</div>
          <div className="text-[14px] font-semibold text-[#94a3b8] mt-0.5">
            <DiffText before={b?.basics.label} after={tailored.basics.label} />
          </div>
          <div className="mt-2 text-[12px] text-[#94a3b8]">
            {[tailored.basics.email, tailored.basics.phone, tailored.basics.location, tailored.basics.url].filter(Boolean).join('  ·  ')}
          </div>
        </header>

        {/* Summary */}
        <SectionHead title="Summary" />
        <p className="text-[12.5px] leading-relaxed text-[#cbd5e1]">
          <DiffText before={b?.basics.summary} after={tailored.basics.summary} />
        </p>

        {/* Experience */}
        <SectionHead title="Experience" />
        {tailored.work.map((w, i) => {
          const bw = matchByName(b?.work, w.name, i);
          return (
            <div key={i} className="mt-2.5 first:mt-1.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-bold text-[13.5px] text-[#e2e8f0]">{w.name}</span>
                <span className="text-[12px] font-bold text-[#94a3b8] whitespace-nowrap">
                  {[w.startDate, w.endDate].filter(Boolean).join(' – ')}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-3 mt-0.5">
                <span className="italic text-[12.5px] text-[#cbd5e1]">
                  <DiffText before={bw?.position} after={w.position} />
                </span>
                {w.location && <span className="italic text-[12px] text-[#64748b] whitespace-nowrap">{w.location}</span>}
              </div>
              <BulletDiff before={bw?.highlights} after={w.highlights} />
            </div>
          );
        })}

        {/* Education — facts, shown plain. */}
        {tailored.education.length > 0 && (
          <>
            <SectionHead title="Education" />
            {tailored.education.map((e, i) => (
              <div key={i} className="mt-2.5 first:mt-1.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-bold text-[13.5px] text-[#e2e8f0]">{e.institution}</span>
                  <span className="text-[12px] font-bold text-[#94a3b8] whitespace-nowrap">
                    {[e.startDate, e.endDate].filter(Boolean).join(' – ')}
                  </span>
                </div>
                <div className="italic text-[12.5px] text-[#cbd5e1] mt-0.5">{[e.studyType, e.area].filter(Boolean).join(' ')}</div>
              </div>
            ))}
          </>
        )}

        {/* Skills */}
        <SectionHead title="Skills" />
        <div className="space-y-1">
          {tailored.skills.map((s, i) => {
            const bs = matchByName(b?.skills, s.name, i);
            return (
              <div key={i} className="flex items-baseline gap-1.5 text-[12.5px] leading-relaxed">
                <span className="font-bold text-[#e2e8f0] whitespace-nowrap">{s.name}:</span>
                <span className="flex-1 text-[#cbd5e1]">
                  <DiffText before={(bs?.keywords || []).join(', ')} after={(s.keywords || []).join(', ')} />
                </span>
              </div>
            );
          })}
        </div>

        {/* Projects */}
        {tailored.projects.length > 0 && (
          <>
            <SectionHead title="Projects" />
            {tailored.projects.map((p, i) => {
              const bp = matchByName(b?.projects, p.name, i);
              return (
                <div key={i} className="mt-2.5 first:mt-1.5">
                  <div className="font-bold text-[13.5px] text-[#e2e8f0]">{p.name}</div>
                  {p.description && (
                    <div className="italic text-[12.5px] text-[#cbd5e1] mt-0.5">
                      <DiffText before={bp?.description} after={p.description} />
                    </div>
                  )}
                  <BulletDiff before={bp?.highlights} after={p.highlights} />
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}

// ── matching ─────────────────────────────────────────────────────────────────
function matchByName<T extends { name?: string }>(list: T[] | undefined, name: string | undefined, index: number): T | undefined {
  if (!list || list.length === 0) return undefined;
  const n = (name || '').trim().toLowerCase();
  if (n) {
    const hit = list.find((x) => (x.name || '').trim().toLowerCase() === n);
    if (hit) return hit;
  }
  return list[index]; // same order+count guarantee from the tailor prompt
}

// ── diff rendering ───────────────────────────────────────────────────────────

/**
 * Word-level diff of two strings (jsdiff diffWords). Added words render green, removed words
 * red strike-through, unchanged plain. When `before` is empty the whole `after` is "added".
 */
function DiffText({ before, after }: { before?: string; after?: string }) {
  const a = (before ?? '').trim();
  const t = (after ?? '').trim();
  if (!t && !a) return null;
  if (t === a) return <>{t}</>;
  const parts = diffWords(a, t);
  return (
    <>
      {parts.map((part, i) => {
        if (part.added) {
          return (
            <mark key={i} className="bg-emerald/25 text-emerald rounded-[2px] px-0.5 -mx-0.5 no-underline">
              {part.value}
            </mark>
          );
        }
        if (part.removed) {
          return (
            <del key={i} className="bg-rose/20 text-rose/90 rounded-[2px] px-0.5 -mx-0.5 line-through decoration-rose/60">
              {part.value}
            </del>
          );
        }
        return <span key={i}>{part.value}</span>;
      })}
    </>
  );
}

/**
 * Diff a list of bullets. Bullets are matched positionally (the tailor prompt keeps the same
 * bullet slots per role); an extra tailored bullet with no base counterpart is fully added,
 * and a base bullet with no tailored counterpart is fully removed.
 */
function BulletDiff({ before, after }: { before?: string[]; after?: string[] }) {
  const b = before ?? [];
  const a = after ?? [];
  const n = Math.max(a.length, b.length);
  if (n === 0) return null;
  const rows = Array.from({ length: n }, (_, i) => ({ before: b[i], after: a[i] }));
  return (
    <ul className="mt-1 space-y-0.5">
      {rows.map((r, i) => {
        // A base-only bullet (removed entirely): show it struck through.
        if (r.after == null) {
          return (
            <li key={i} className="flex gap-2 text-[12px] leading-relaxed">
              <span className="select-none text-rose/70 mt-[1px]">•</span>
              <del className="bg-rose/20 text-rose/90 rounded-[2px] px-0.5 line-through decoration-rose/60">{r.before}</del>
            </li>
          );
        }
        return (
          <li key={i} className="flex gap-2 text-[12px] leading-relaxed text-[#e2e8f0]">
            <span className="select-none text-[#64748b] mt-[1px]">•</span>
            <span className="flex-1">
              <DiffText before={r.before} after={r.after} />
            </span>
          </li>
        );
      })}
    </ul>
  );
}

// ── section heading (matches the editor's) ───────────────────────────────────
function SectionHead({ title }: { title: string }) {
  return (
    <div className="mt-5 mb-2 border-b border-[#2a2a45] pb-0.5">
      <h2 className="text-[13px] font-bold uppercase tracking-wider text-[#e2e8f0]">{title}</h2>
    </div>
  );
}
