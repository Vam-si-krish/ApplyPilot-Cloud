/**
 * Per-job résumé tailoring, ported to the worker (the heavy LLM call can run
 * 30–90s, which exceeds Netlify's ~26s synchronous function ceiling — so it runs
 * here on the always-on Mac instead of in a serverless route). This is a faithful
 * port of the app's lib/resumeTailor.ts + lib/llm.ts + lib/resume.ts (kept in
 * sync by hand; see ADR 0026 for the tailoring rules).
 *
 * ONE LLM call that rewrites the user's résumé to win interviews for a specific
 * job and pass ATS keyword screening, while anchoring verifiable facts (employers,
 * titles, dates, education) to the base résumé via mergeTailored.
 */

// ── LLM client (port of lib/llm.ts) ──────────────────────────────────────────

const PROVIDER_TABLE = {
  gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/v1', defaultModel: 'gemini-2.0-flash' },
  openai: { baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o-mini' },
  deepseek: { baseUrl: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-chat' },
  anthropic: { baseUrl: 'https://api.anthropic.com/v1', defaultModel: 'claude-haiku-4-5-20251001' },
};

const GEMINI_NATIVE_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const MAX_RETRIES = 5;
const TIMEOUT_MS = 120_000;
const RATE_LIMIT_BASE_WAIT_MS = 10_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class GeminiCompatForbidden extends Error {}
class HttpStatusError extends Error {
  constructor(status, headers, body) {
    super(`HTTP ${status}: ${String(body).slice(0, 200)}`);
    this.status = status;
    this.headers = headers;
    this.body = body;
  }
}

class LLMClient {
  constructor(baseUrl, model, apiKey) {
    this.baseUrl = baseUrl;
    this.model = model;
    this.apiKey = apiKey;
    this.isGemini = baseUrl.includes('generativelanguage.googleapis.com');
    this.isAnthropic = baseUrl.includes('api.anthropic.com');
    this.useNativeGemini = false;
  }

  async fetchWithTimeout(url, init) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(t);
    }
  }

  async chatAnthropic(messages, temperature, maxTokens) {
    const systemText = [];
    const anthMessages = [];
    for (const msg of messages) {
      if (msg.role === 'system') systemText.push(msg.content);
      else anthMessages.push({ role: msg.role === 'user' ? 'user' : 'assistant', content: msg.content });
    }
    const payload = { model: this.model, max_tokens: maxTokens, temperature, messages: anthMessages };
    if (systemText.length) payload.system = systemText.join('\n\n');

    const resp = await this.fetchWithTimeout('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) throw new HttpStatusError(resp.status, resp.headers, await resp.text());
    const data = await resp.json();
    return (data.content || []).filter((b) => b.type === 'text').map((b) => b.text || '').join('');
  }

  async chatNativeGemini(messages, temperature, maxTokens) {
    const contents = [];
    const systemParts = [];
    for (const msg of messages) {
      if (msg.role === 'system') systemParts.push({ text: msg.content });
      else if (msg.role === 'user') contents.push({ role: 'user', parts: [{ text: msg.content }] });
      else if (msg.role === 'assistant') contents.push({ role: 'model', parts: [{ text: msg.content }] });
    }
    const payload = { contents, generationConfig: { temperature, maxOutputTokens: maxTokens } };
    if (systemParts.length) payload.systemInstruction = { parts: systemParts };

    const url = `${GEMINI_NATIVE_BASE}/models/${this.model}:generateContent?key=${encodeURIComponent(this.apiKey)}`;
    const resp = await this.fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) throw new HttpStatusError(resp.status, resp.headers, await resp.text());
    const data = await resp.json();
    return data.candidates[0].content.parts[0].text;
  }

  async chatCompat(messages, temperature, maxTokens) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    const resp = await this.fetchWithTimeout(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: this.model, messages, temperature, max_tokens: maxTokens }),
    });
    if ((resp.status === 403 || resp.status === 404) && this.isGemini) {
      throw new GeminiCompatForbidden(await resp.text());
    }
    if (!resp.ok) throw new HttpStatusError(resp.status, resp.headers, await resp.text());
    const data = await resp.json();
    return data.choices[0].message.content;
  }

  async chat(messages, opts = {}) {
    const temperature = opts.temperature ?? 0.0;
    const maxTokens = opts.maxTokens ?? 4096;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        if (this.isAnthropic) return await this.chatAnthropic(messages, temperature, maxTokens);
        if (this.useNativeGemini) return await this.chatNativeGemini(messages, temperature, maxTokens);
        return await this.chatCompat(messages, temperature, maxTokens);
      } catch (err) {
        if (err instanceof GeminiCompatForbidden) {
          this.useNativeGemini = true;
          try {
            return await this.chatNativeGemini(messages, temperature, maxTokens);
          } catch (nativeErr) {
            const s = nativeErr instanceof HttpStatusError ? `${nativeErr.status} — ${String(nativeErr.body).slice(0, 200)}` : String(nativeErr);
            throw new Error(`Both Gemini endpoints failed. Compat: 403/404. Native: ${s}`);
          }
        }
        if (err instanceof HttpStatusError && (err.status === 429 || err.status === 503) && attempt < MAX_RETRIES - 1) {
          const retryAfter = err.headers.get('Retry-After') || err.headers.get('X-RateLimit-Reset-Requests');
          let wait;
          if (retryAfter) {
            const parsed = parseFloat(retryAfter);
            wait = Number.isNaN(parsed) ? RATE_LIMIT_BASE_WAIT_MS * 2 ** attempt : parsed * 1000;
          } else {
            wait = Math.min(RATE_LIMIT_BASE_WAIT_MS * 2 ** attempt, 60_000);
          }
          await sleep(wait);
          continue;
        }
        if (err instanceof Error && err.name === 'AbortError' && attempt < MAX_RETRIES - 1) {
          await sleep(Math.min(RATE_LIMIT_BASE_WAIT_MS * 2 ** attempt, 60_000));
          continue;
        }
        throw err;
      }
    }
    throw new Error('LLM request failed after all retries');
  }
}

/** Build a client from an explicit provider + model + key (vault path, ADR 0006/0025). */
export function makeClient(provider, model, apiKey) {
  const cfg = PROVIDER_TABLE[String(provider).trim().toLowerCase()] ?? PROVIDER_TABLE.openai;
  return new LLMClient(cfg.baseUrl, (model || '').trim() || cfg.defaultModel, apiKey);
}

// ── Résumé helpers (port of lib/resume.ts) ───────────────────────────────────

function str(v) {
  if (typeof v === 'string') {
    const t = v.trim();
    return t.length ? t : undefined;
  }
  if (typeof v === 'number') return String(v);
  return undefined;
}

function strList(v) {
  if (Array.isArray(v)) return v.filter((x) => typeof x === 'string').map((s) => s.trim()).filter(Boolean);
  if (typeof v === 'string') return v.split(/\r?\n|,/).map((s) => s.trim()).filter(Boolean);
  return [];
}

function asObj(v) {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

function flattenLocation(v) {
  if (typeof v === 'string') return str(v);
  const o = asObj(v);
  const parts = [str(o.city), str(o.region) ?? str(o.countryCode) ?? str(o.country)].filter(Boolean);
  if (parts.length) return parts.join(', ');
  return str(o.address);
}

function normalizeBasics(v) {
  const o = asObj(v);
  const profiles = Array.isArray(o.profiles)
    ? o.profiles
        .map((p) => {
          const po = asObj(p);
          const network = str(po.network);
          const url = str(po.url) ?? str(po.username);
          return network || url ? { network, url } : null;
        })
        .filter((p) => p !== null)
    : undefined;
  const b = {
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

function normalizeWork(v) {
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

function normalizeEducation(v) {
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

function normalizeSkills(v) {
  if (!Array.isArray(v)) return [];
  return v
    .map((raw) => {
      if (typeof raw === 'string') {
        const name = str(raw);
        return name ? { name, keywords: [] } : null;
      }
      const o = asObj(raw);
      return { name: str(o.name) ?? str(o.category), keywords: strList(o.keywords) };
    })
    .filter((s) => s !== null);
}

function normalizeProjects(v) {
  if (!Array.isArray(v)) return [];
  return v.map((raw) => {
    const o = asObj(raw);
    return { name: str(o.name), description: str(o.description), url: str(o.url), highlights: strList(o.highlights) };
  });
}

/** Coerce arbitrary/partial JSON into a well-formed ResumeDoc. Never throws. */
export function normalizeResume(input) {
  const o = asObj(input);
  return {
    basics: normalizeBasics(o.basics),
    work: normalizeWork(o.work),
    education: normalizeEducation(o.education),
    skills: normalizeSkills(o.skills),
    projects: normalizeProjects(o.projects),
  };
}

/** Pull the first balanced JSON object out of an LLM response. Returns null if none parses. */
export function extractJsonObject(text) {
  if (!text) return null;
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
            break;
          }
        }
      }
    }
  }
  return null;
}

// ── Tailoring (port of lib/resumeTailor.ts) ──────────────────────────────────

export const TAILOR_PROMPT = `You are an expert résumé writer helping the candidate LAND INTERVIEWS for a specific job, and optimizing the résumé to pass ATS keyword screening (aim for a strong keyword match with the posting).

You may ENHANCE the résumé, not merely reword it. You ARE allowed to:
- Rewrite bullet points to foreground the job's requirements and keywords, adding plausible detail, metrics, and scenarios consistent with the candidate's real roles (e.g., if they touched WebSockets, describe real-time features in depth).
- ADD skills the job wants when the candidate could CREDIBLY have them or learn them in under ~15 days given their background, or that are closely ADJACENT to skills they already list. Weave those skills into the bullets too.
- Reorder/regroup skills and reframe the summary to match the role.

LENGTH — keep it to ONE PAGE; the tailored résumé must be NET-NEUTRAL in length (same as the base or shorter):
- Do NOT increase the number of bullet points (highlights) in ANY role or project. Each must have the SAME count as the base résumé, or fewer — NEVER more.
- You cannot just append a new point. To surface a job-relevant point, REPLACE or MERGE the LEAST important existing bullet in that role, or modify an existing bullet to carry the new emphasis. Adding one means removing/condensing one.
- Keep individual bullets to roughly one line; tighten wordy ones instead of growing the résumé.
- Skills are compact — you MAY still add skills (they don't push it to a second page).

HARD LIMITS — never change these verifiable facts (a background check would catch them):
- Employer / company names, job titles, and employment dates: keep EXACTLY as the base résumé.
- Education: institutions, degrees, and dates: keep EXACTLY. Do not invent new jobs, employers, or degrees.

STAY PLAUSIBLE: only add skills/claims a person with THIS candidate's background and seniority could believably have or quickly acquire. No wildly unrelated skills, no absurd seniority — it must hold up in an interview.

DISCLOSURE — also report what you changed: include a top-level "_changes" array of short strings listing (a) every skill you ADDED that wasn't in the base résumé, and (b) any notable points/scenarios you INVENTED or significantly embellished. Be honest and specific here.

Output ONLY a JSON object (no markdown/commentary), the SAME shape as the base résumé PLUS "_changes":
{
  "basics": { "name":"", "label":"", "email":"", "phone":"", "url":"", "location":"", "summary":"", "profiles":[{"network":"","url":""}] },
  "work": [ { "name":"", "position":"", "location":"", "startDate":"", "endDate":"", "highlights":["",""] } ],
  "education": [ { "institution":"", "area":"", "studyType":"", "startDate":"", "endDate":"", "score":"" } ],
  "skills": [ { "name":"", "keywords":["",""] } ],
  "projects": [ { "name":"", "description":"", "url":"", "highlights":[] } ],
  "_changes": ["Added Kubernetes (adjacent to your Docker/CI experience)", "Replaced a generic bullet with a detailed WebSockets real-time-collaboration one"]
}
Keep work entries in the same order and count, with the same companies, titles, and dates as the base résumé, and the SAME number of highlights per role/project as the base (or fewer) — never more.`;

export function buildTailorMessages(base, job, signals) {
  const desc = (job.full_description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 12000);
  const matched = (signals.matched ?? []).filter(Boolean);
  const unmatched = (signals.unmatched ?? []).filter(Boolean);
  const user =
    `BASE RÉSUMÉ (the candidate's real experience — anchor employers/titles/dates/education to this — JSON):\n${JSON.stringify(base)}\n\n` +
    `TARGET JOB:\nTitle: ${job.title ?? 'N/A'}\nCompany: ${job.company ?? 'N/A'}\n\n` +
    `JOB DESCRIPTION:\n${desc}\n\n` +
    `SIGNALS (from our scorer):\n` +
    `- Job keywords: ${signals.keywords || 'N/A'}\n` +
    `- Candidate skills this job mentions (lead with these): ${matched.length ? matched.join(', ') : 'N/A'}\n` +
    `- Candidate skills not mentioned by the job: ${unmatched.length ? unmatched.join(', ') : 'N/A'}\n` +
    `- Requirements the job wants that the candidate may lack — ADD the plausible/quick-to-learn ones: ${signals.missing || 'N/A'}`;
  return [
    { role: 'system', content: TAILOR_PROMPT },
    { role: 'user', content: user },
  ];
}

function skillSet(doc) {
  const set = new Set();
  for (const g of doc.skills) for (const k of g.keywords) set.add(k.toLowerCase());
  return set;
}

/**
 * Length-neutral highlight merge (ADR 0029): take the model's bullets but never MORE
 * than the base had, so the résumé can't overflow one page. Empty/omitted → keep base.
 */
function capHighlights(baseHl, tailoredHl) {
  if (!tailoredHl || tailoredHl.length === 0) return baseHl;
  return baseHl.length > 0 ? tailoredHl.slice(0, baseHl.length) : tailoredHl;
}

/** Merge the model's draft onto the base, anchoring verifiable facts (ADR 0026) and
 *  capping bullet counts to keep it one page (ADR 0029). Pure — never throws. */
export function mergeTailored(base, tailored) {
  const basics = {
    ...base.basics,
    summary: tailored.basics.summary?.trim() || base.basics.summary,
    label: tailored.basics.label?.trim() || base.basics.label,
  };
  const work = base.work.map((b, i) => ({ ...b, highlights: capHighlights(b.highlights, tailored.work[i]?.highlights) }));
  let skills = tailored.skills.filter((g) => g.keywords.length > 0);
  if (skills.length === 0) skills = base.skills;
  const projects = base.projects.map((b, i) => ({ ...b, highlights: capHighlights(b.highlights, tailored.projects[i]?.highlights) }));
  return { basics, work, education: base.education, skills, projects };
}

/** Skills present in the merged résumé that weren't in the base (what the AI added). */
export function addedSkills(base, merged) {
  const had = skillSet(base);
  const out = [];
  const seen = new Set();
  for (const g of merged.skills) {
    for (const k of g.keywords) {
      const lk = k.toLowerCase();
      if (!had.has(lk) && !seen.has(lk)) {
        seen.add(lk);
        out.push(k);
      }
    }
  }
  return out;
}

function extractChangeNotes(json) {
  if (json && typeof json === 'object' && Array.isArray(json._changes)) {
    return json._changes.filter((x) => typeof x === 'string').map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

/**
 * Produce a tailored résumé for a job (ADR 0026). One LLM call. Returns the merged
 * résumé plus `changes` (added skills + the model's invented-point notes).
 * Throws on empty base / unparseable reply.
 */
export async function tailorResume(base, job, signals, client) {
  if (!base || base.work.length === 0) {
    throw new Error('Base résumé is empty — build it under Applications → Base résumé first.');
  }
  const response = await client.chat(buildTailorMessages(base, job, signals), { maxTokens: 4000, temperature: 0.35 });
  const json = extractJsonObject(response);
  if (json == null) throw new Error('Could not parse a tailored résumé from the model response.');
  const notes = extractChangeNotes(json);
  const resume = mergeTailored(base, normalizeResume(json));
  return { resume, changes: { addedSkills: addedSkills(base, resume), notes } };
}
