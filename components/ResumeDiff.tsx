'use client';

import { diffWords } from 'diff';
import type { ResumeDoc } from '@/lib/types';
import { ResumePaperFrame, ResumeSectionHeading } from '@/components/ResumePaper';

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
    <ResumePaperFrame
      mode="review"
      toolbar={
        <div className="flex flex-wrap items-center gap-3 text-[10.5px] font-medium">
          <span className="inline-flex items-center gap-1.5 text-emerald">
            <span className="inline-block h-3 w-3 rounded-sm border border-emerald/50 bg-emerald/25" /> Added
          </span>
          <span className="inline-flex items-center gap-1.5 text-rose">
            <span className="inline-block h-3 w-3 rounded-sm border border-rose/50 bg-rose/25" /> Removed
          </span>
        </div>
      }
    >
      {/* Header — facts are anchored, so show plain (no diff noise). */}
      <header className="mb-1 text-center">
        <div className="text-[25px] font-bold leading-tight tracking-tight text-[#1a1a1a] sm:text-[28px]">{tailored.basics.name || '—'}</div>
        <div className="mt-0.5 text-[13px] font-semibold text-[#444] sm:text-[14px]">
          <DiffText before={b?.basics.label} after={tailored.basics.label} />
        </div>
        <div className="mt-2 text-[11.5px] leading-relaxed text-[#444] sm:text-[12px]">
          {[tailored.basics.email, tailored.basics.phone, tailored.basics.location, tailored.basics.url].filter(Boolean).join('  ·  ')}
        </div>
        {(tailored.basics.profiles || []).length > 0 && (
          <div className="mt-1 text-[11.5px] text-[#1f4e79] sm:text-[12px]">
            {(tailored.basics.profiles || []).map((profile) => profile.network || profile.url).filter(Boolean).join('  ·  ')}
          </div>
        )}
      </header>

      <SectionHead title="Summary" />
      <p className="text-[12.5px] leading-[1.55] text-[#1a1a1a] sm:text-[13px]">
        <DiffText before={b?.basics.summary} after={tailored.basics.summary} />
      </p>

      <SectionHead title="Technical Skills" />
      <div className="space-y-1">
        {tailored.skills.map((s, i) => {
          const bs = matchByName(b?.skills, s.name, i);
          return (
            <div key={i} className="flex items-start gap-1.5 text-[12.5px] leading-[1.5] text-[#1a1a1a] sm:text-[13px]">
              <span className="mt-[1px] select-none">•</span>
              <span className="whitespace-nowrap font-bold">{s.name}:</span>
              <span className="flex-1">
                <DiffText before={(bs?.keywords || []).join(', ')} after={(s.keywords || []).join(', ')} />
              </span>
            </div>
          );
        })}
      </div>

      <SectionHead title="Professional Experience" />
      {tailored.work.map((w, i) => {
        const bw = matchByName(b?.work, w.name, i);
        return (
          <div key={i} className="mt-3 first:mt-1.5">
            <div className="flex flex-col items-start gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
              <span className="text-[13.5px] font-bold text-[#1a1a1a] sm:text-[14px]">{w.name}</span>
              <span className="whitespace-nowrap text-[12px] font-bold text-[#444] sm:text-[12.5px]">
                {[w.startDate, w.endDate].filter(Boolean).join(' – ')}
              </span>
            </div>
            <div className="mt-0.5 flex flex-col items-start gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
              <span className="text-[12.5px] italic text-[#1a1a1a] sm:text-[13px]">
                <DiffText before={bw?.position} after={w.position} />
              </span>
              {w.location && <span className="whitespace-nowrap text-[12px] italic text-[#444] sm:text-[12.5px]">{w.location}</span>}
            </div>
            <BulletDiff before={bw?.highlights} after={w.highlights} />
          </div>
        );
      })}

      {tailored.projects.length > 0 && (
        <>
          <SectionHead title="Projects" />
          {tailored.projects.map((p, i) => {
            const bp = matchByName(b?.projects, p.name, i);
            return (
              <div key={i} className="mt-3 first:mt-1.5">
                <div className="text-[13.5px] font-bold text-[#1a1a1a] sm:text-[14px]">{p.name}</div>
                {p.description && (
                  <div className="mt-0.5 text-[12.5px] italic text-[#1a1a1a] sm:text-[13px]">
                    <DiffText before={bp?.description} after={p.description} />
                  </div>
                )}
                <BulletDiff before={bp?.highlights} after={p.highlights} />
              </div>
            );
          })}
        </>
      )}

      {tailored.education.length > 0 && (
        <>
          <SectionHead title="Education" />
          {tailored.education.map((e, i) => (
            <div key={i} className="mt-3 first:mt-1.5">
              <div className="flex flex-col items-start gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
                <span className="text-[13.5px] font-bold text-[#1a1a1a] sm:text-[14px]">{[e.studyType, e.area].filter(Boolean).join(', ')}</span>
                <span className="whitespace-nowrap text-[12px] font-bold text-[#444] sm:text-[12.5px]">
                  {[e.startDate, e.endDate].filter(Boolean).join(' – ')}
                </span>
              </div>
              <div className="mt-0.5 text-[12.5px] italic text-[#444] sm:text-[13px]">{e.institution}</div>
            </div>
          ))}
        </>
      )}
    </ResumePaperFrame>
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
            <mark key={i} className="-mx-0.5 rounded-[3px] bg-[#dcfce7] px-0.5 text-[#166534] no-underline ring-1 ring-[#86efac]/60">
              {part.value}
            </mark>
          );
        }
        if (part.removed) {
          return (
            <del key={i} className="-mx-0.5 rounded-[3px] bg-[#fee2e2] px-0.5 text-[#991b1b] line-through decoration-[#dc2626]/60 ring-1 ring-[#fca5a5]/50">
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
    <ul className="mt-1 space-y-1">
      {rows.map((r, i) => {
        // A base-only bullet (removed entirely): show it struck through.
        if (r.after == null) {
          return (
            <li key={i} className="flex gap-2 text-[12.5px] leading-[1.5] sm:text-[13px]">
              <span className="mt-[1px] select-none text-[#991b1b]">•</span>
              <del className="rounded-[3px] bg-[#fee2e2] px-0.5 text-[#991b1b] line-through decoration-[#dc2626]/60 ring-1 ring-[#fca5a5]/50">{r.before}</del>
            </li>
          );
        }
        return (
          <li key={i} className="flex gap-2 text-[12.5px] leading-[1.5] text-[#1a1a1a] sm:text-[13px]">
            <span className="mt-[1px] select-none text-[#1a1a1a]">•</span>
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
  return <ResumeSectionHeading title={title} />;
}
