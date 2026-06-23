/**
 * Pure helpers for the structured base/tailored résumé (ADR 0024). No I/O, no LLM
 * — safe to use anywhere (client editor, server routes, the future worker) and
 * unit-tested directly.
 *
 * `normalizeResume` is the defensive boundary: it coerces arbitrary/partial JSON
 * (LLM output, older stored rows, a hand-edited blob) into a well-formed ResumeDoc
 * so the rest of the app can trust the shape. Same discipline as the score parser.
 */
import type { ResumeDoc, ResumeBasics, ResumeWork, ResumeEducation, ResumeSkill, ResumeProject } from './types';

/** A blank, well-formed résumé. */
export function emptyResume(): ResumeDoc {
  return { basics: {}, work: [], education: [], skills: [], projects: [] };
}

function str(v: unknown): string | undefined {
  if (typeof v === 'string') {
    const t = v.trim();
    return t.length ? t : undefined;
  }
  if (typeof v === 'number') return String(v);
  return undefined;
}

/** Strings only, trimmed, blanks dropped. Accepts an array or a newline/comma string.
 *  Array entries must be genuine strings — a stray number/object in a bullet or
 *  keyword list is malformed and dropped (not coerced). */
function strList(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v.filter((x): x is string => typeof x === 'string').map((s) => s.trim()).filter(Boolean);
  }
  if (typeof v === 'string') {
    return v
      .split(/\r?\n|,/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** JSON Resume nests location as an object; collapse it (or a string) to "City, Region". */
function flattenLocation(v: unknown): string | undefined {
  if (typeof v === 'string') return str(v);
  const o = asObj(v);
  const parts = [str(o.city), str(o.region) ?? str(o.countryCode) ?? str(o.country)].filter(Boolean);
  if (parts.length) return parts.join(', ');
  return str(o.address);
}

function normalizeBasics(v: unknown): ResumeBasics {
  const o = asObj(v);
  type ResumeProfile = { network?: string; url?: string };
  const profiles = Array.isArray(o.profiles)
    ? o.profiles
        .map((p): ResumeProfile | null => {
          const po = asObj(p);
          const network = str(po.network);
          const url = str(po.url) ?? str(po.username);
          return network || url ? { network, url } : null;
        })
        .filter((p): p is ResumeProfile => p !== null)
    : undefined;
  const b: ResumeBasics = {
    name: str(o.name),
    label: str(o.label) ?? str(o.title),
    email: str(o.email),
    phone: str(o.phone),
    url: str(o.url) ?? str(o.website),
    location: flattenLocation(o.location),
    summary: str(o.summary),
  };
  if (profiles && profiles.length) b.profiles = profiles;
  return b;
}

function normalizeWork(v: unknown): ResumeWork[] {
  if (!Array.isArray(v)) return [];
  return v.map((raw) => {
    const o = asObj(raw);
    return {
      name: str(o.name) ?? str(o.company),
      position: str(o.position) ?? str(o.title),
      location: flattenLocation(o.location),
      url: str(o.url),
      startDate: str(o.startDate),
      endDate: str(o.endDate),
      highlights: strList(o.highlights ?? o.summary),
    };
  });
}

function normalizeEducation(v: unknown): ResumeEducation[] {
  if (!Array.isArray(v)) return [];
  return v.map((raw) => {
    const o = asObj(raw);
    return {
      institution: str(o.institution) ?? str(o.school),
      area: str(o.area),
      studyType: str(o.studyType) ?? str(o.degree),
      startDate: str(o.startDate),
      endDate: str(o.endDate),
      score: str(o.score) ?? str(o.gpa),
    };
  });
}

function normalizeSkills(v: unknown): ResumeSkill[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((raw): ResumeSkill | null => {
      // Tolerate a bare string skill ("React") as a one-keyword group.
      if (typeof raw === 'string') {
        const name = str(raw);
        return name ? { name, keywords: [] } : null;
      }
      const o = asObj(raw);
      return { name: str(o.name) ?? str(o.category), keywords: strList(o.keywords) };
    })
    .filter((s): s is ResumeSkill => s !== null);
}

function normalizeProjects(v: unknown): ResumeProject[] {
  if (!Array.isArray(v)) return [];
  return v.map((raw) => {
    const o = asObj(raw);
    return {
      name: str(o.name),
      description: str(o.description),
      url: str(o.url),
      highlights: strList(o.highlights),
    };
  });
}

/** Coerce arbitrary/partial JSON into a well-formed ResumeDoc. Never throws. */
export function normalizeResume(input: unknown): ResumeDoc {
  const o = asObj(input);
  return {
    basics: normalizeBasics(o.basics),
    work: normalizeWork(o.work),
    education: normalizeEducation(o.education),
    skills: normalizeSkills(o.skills),
    projects: normalizeProjects(o.projects),
  };
}

/**
 * Flatten a structured résumé into plain text for the fit scorer (ADR 0029). The
 * scorer reads a résumé string + job; this renders the tailored ResumeDoc the same
 * way a recruiter would read it (summary, roles + bullets, education, skills,
 * projects) so the tailored résumé can be scored against the job.
 */
export function resumeToText(doc: ResumeDoc): string {
  const out: string[] = [];
  const b = doc.basics;
  if (b.name) out.push(b.name);
  if (b.label) out.push(b.label);
  if (b.summary) out.push(`\n${b.summary}`);

  if (doc.work.length) {
    out.push('\nEXPERIENCE');
    for (const w of doc.work) {
      const head = [w.position, w.name].filter(Boolean).join(' — ');
      const dates = [w.startDate, w.endDate].filter(Boolean).join(' to ');
      out.push([head, dates].filter(Boolean).join('  '));
      for (const h of w.highlights) out.push(`- ${h}`);
    }
  }

  if (doc.education.length) {
    out.push('\nEDUCATION');
    for (const e of doc.education) {
      out.push([e.studyType, e.area, e.institution].filter(Boolean).join(', '));
    }
  }

  if (doc.skills.length) {
    out.push('\nSKILLS');
    for (const s of doc.skills) {
      const kws = s.keywords.join(', ');
      out.push([s.name, kws].filter(Boolean).join(': '));
    }
  }

  if (doc.projects.length) {
    out.push('\nPROJECTS');
    for (const p of doc.projects) {
      out.push([p.name, p.description].filter(Boolean).join(' — '));
      for (const h of p.highlights) out.push(`- ${h}`);
    }
  }

  return out.join('\n').trim();
}

/**
 * Pull the first JSON object out of an LLM response — tolerates ```json fences and
 * surrounding prose by scanning for balanced braces. Returns null if none parses.
 */
export function extractJsonObject(text: string): unknown {
  if (!text) return null;
  // Fast path: a fenced ```json block.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = fenced ? [fenced[1], text] : [text];
  for (const c of candidates) {
    const start = c.indexOf('{');
    if (start === -1) continue;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < c.length; i++) {
      const ch = c[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(c.slice(start, i + 1));
          } catch {
            break; // try the next candidate
          }
        }
      }
    }
  }
  return null;
}
