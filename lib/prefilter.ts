/**
 * ATS-style résumé↔job match score (v2, ADR 0053; supersedes the plain IDF
 * coverage of ADR 0008). A cheap, local, no-API estimate of how an applicant
 * tracking system would rate the résumé against a job posting, used as the
 * user's FIRST filter (before any LLM scoring — which this never replaces).
 *
 * Modeled on how commercial ATS scanners (Jobscan-style match rates) and the
 * open-source ats-screener engine (MIT, github.com/sunnypatell/ats-screener)
 * compute a match:
 *
 *   score = 55% skills   — coverage of the skills the JD asks for, extracted
 *                          via a curated lexicon + alias normalization
 *                          (k8s→kubernetes). Skills in a required/must-have
 *                          section, in the job title, or repeated in the JD
 *                          weigh more; nice-to-haves weigh less.
 *         + 15% title    — job-title ↔ résumé role alignment (level words like
 *                          "senior" stripped; developer≈engineer).
 *         + 30% keywords — IDF-weighted coverage of the JD's remaining
 *                          vocabulary (the v1 metric, kept for domain terms
 *                          the lexicon doesn't know).
 *         − penalties    — years-of-experience gap, required advanced degree.
 *   Clearance/citizenship-restricted postings are capped at 5 (mirrors the
 *   LLM scorer's hard block, ADR 0038).
 *
 * All functions are pure and dependency-free so they unit-test without a DB
 * or network. HTML descriptions are stripped before any tokenization (v1
 * scored raw HTML — a big source of its noise).
 */

import type { AtsMatchBreakdown } from './types';

// ── HTML → text ──────────────────────────────────────────────────────────────

/** Strip HTML to plain text, turning block-level boundaries into newlines so
 *  line-based section detection (required vs nice-to-have) still works. */
export function stripHtml(html: string): string {
  if (!html) return '';
  let t = html
    .replace(/<\s*(?:br|\/p|\/li|\/div|\/h[1-6]|\/ul|\/ol|\/tr)\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  t = t
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#x27;|&#39;|&apos;/gi, "'")
    .replace(/&#\d+;/g, ' ');
  return t.replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').trim();
}

// ── v1 primitives (kept: they power the "other keywords" component) ─────────

// Compact English stopword list + a little job-posting boilerplate. Kept small on
// purpose: real skill/role words must survive so they can drive the match.
const STOPWORDS = new Set<string>([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'else', 'of', 'to', 'in', 'on', 'at', 'by',
  'for', 'with', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'this', 'that', 'these',
  'those', 'it', 'its', 'we', 'you', 'your', 'our', 'they', 'their', 'will', 'would', 'can', 'could',
  'should', 'may', 'might', 'must', 'have', 'has', 'had', 'do', 'does', 'did', 'not', 'no', 'so',
  'than', 'too', 'very', 'just', 'from', 'up', 'out', 'about', 'into', 'over', 'all', 'any', 'each',
  'more', 'most', 'other', 'some', 'such', 'who', 'whom', 'which', 'what', 'when', 'where', 'how',
  'i', 'me', 'my', 'he', 'she', 'his', 'her', 'them', 'us', 'am', 'also', 'etc',
]);

/**
 * Split text into comparable terms. Lowercased; keeps tech tokens like `c++`,
 * `c#`, `.net`, `node.js`. Drops stopwords and tokens shorter than 2 chars.
 */
export function tokenize(text: string): string[] {
  const matches = (text || '').toLowerCase().match(/[a-z0-9][a-z0-9+#.]*/g) || [];
  const out: string[] = [];
  for (let tok of matches) {
    tok = tok.replace(/^\.+|\.+$/g, ''); // trim leading/trailing dots ("node." -> "node")
    if (tok.length < 2) continue;
    if (STOPWORDS.has(tok)) continue;
    out.push(tok);
  }
  return out;
}

/** idf(t) = ln(N / df(t)) over the given tokenized documents (df counts docs, not occurrences). */
export function computeIdf(docs: string[][]): Map<string, number> {
  const n = docs.length;
  const df = new Map<string, number>();
  for (const doc of docs) {
    for (const t of new Set(doc)) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const idf = new Map<string, number>();
  for (const [t, d] of df) idf.set(t, Math.log(n / d));
  return idf;
}

/**
 * IDF-weighted fraction of the job's distinct terms that the résumé covers, in
 * [0,1]. Terms whose idf is 0 (appear in every doc) contribute nothing. Returns 0
 * when the job has no usable weighted vocabulary.
 */
export function coverageScore(resumeTerms: Set<string>, jobTokens: string[], idf: Map<string, number>): number {
  let denom = 0;
  let numer = 0;
  for (const t of new Set(jobTokens)) {
    const w = idf.get(t) ?? 0;
    if (w <= 0) continue;
    denom += w;
    if (resumeTerms.has(t)) numer += w;
  }
  if (denom <= 0) return 0;
  return numer / denom;
}

// ── Skill lexicon ────────────────────────────────────────────────────────────
// Canonical skill first, then aliases. Multi-word aliases are matched over the
// raw word stream (stopwords included) so "ruby on rails" works. Curated for
// software/data roles — postings outside it still score via the keywords
// component. Alias groups informed by ats-screener's synonym map (MIT).

const SKILL_GROUPS: string[][] = [
  // languages
  ['javascript', 'js', 'ecmascript', 'es6'],
  ['typescript', 'ts'],
  ['python', 'python3'],
  ['java'],
  ['c++', 'cpp'],
  ['c#', 'csharp', 'c sharp'],
  // bare "go" would match "go-to-market" / "on the go" boilerplate
  ['golang', 'go lang'],
  ['rust'],
  ['ruby'],
  ['php'],
  ['swift'],
  ['kotlin'],
  ['scala'],
  ['objective-c', 'objc', 'objective c'],
  ['dart'],
  ['elixir'],
  ['perl'],
  ['matlab'],
  ['sql'],
  ['bash', 'shell scripting', 'shell'],
  // frontend
  ['react', 'react.js', 'reactjs'],
  ['angular', 'angularjs', 'angular.js'],
  ['vue', 'vue.js', 'vuejs'],
  ['svelte', 'sveltekit'],
  ['next.js', 'nextjs'],
  ['nuxt', 'nuxt.js'],
  ['redux'],
  ['html', 'html5'],
  ['css', 'css3'],
  ['sass', 'scss'],
  ['tailwind', 'tailwindcss', 'tailwind css'],
  ['webpack'],
  ['vite'],
  ['jquery'],
  ['storybook'],
  ['d3', 'd3.js'],
  ['webgl', 'three.js', 'threejs'],
  ['responsive design', 'responsive web design'],
  ['accessibility', 'a11y', 'wcag'],
  // backend / APIs
  ['node.js', 'nodejs', 'node'],
  // bare "express" would match "express written consent" EEO boilerplate
  ['express.js', 'expressjs'],
  ['nestjs', 'nest.js'],
  ['django'],
  ['flask'],
  ['fastapi', 'fast api'],
  ['spring', 'spring boot', 'springboot'],
  ['.net', 'dotnet', 'asp.net', 'aspnet'],
  ['ruby on rails', 'rails', 'ror'],
  ['laravel'],
  ['graphql'],
  // bare "rest" would match "the rest of the team"
  ['restful', 'rest api', 'rest apis', 'restful apis', 'restful api'],
  ['grpc'],
  ['microservices', 'micro services', 'microservice'],
  ['websockets', 'websocket'],
  ['serverless'],
  ['oauth', 'oauth2'],
  ['api design', 'api development'],
  // databases / messaging
  ['postgresql', 'postgres', 'psql'],
  ['mysql'],
  ['mongodb', 'mongo'],
  ['redis'],
  ['elasticsearch', 'opensearch', 'elastic search'],
  ['dynamodb', 'dynamo db'],
  ['cassandra'],
  ['sqlite'],
  ['oracle'],
  ['sql server', 'mssql', 't-sql', 'tsql'],
  ['supabase'],
  ['firebase', 'firestore'],
  ['snowflake'],
  ['bigquery', 'big query'],
  ['redshift'],
  ['databricks'],
  ['kafka', 'apache kafka'],
  ['rabbitmq'],
  // cloud / devops
  ['aws', 'amazon web services'],
  ['azure', 'microsoft azure'],
  ['gcp', 'google cloud', 'google cloud platform'],
  ['docker', 'containerization', 'containers'],
  ['kubernetes', 'k8s'],
  ['terraform', 'infrastructure as code', 'iac'],
  ['ansible'],
  ['jenkins'],
  ['ci/cd', 'cicd', 'ci cd', 'continuous integration', 'continuous delivery', 'continuous deployment'],
  ['github actions'],
  ['gitlab'],
  ['git', 'version control'],
  ['linux', 'unix'],
  ['nginx'],
  ['helm'],
  ['prometheus'],
  ['grafana'],
  ['datadog'],
  ['splunk'],
  ['cloudformation'],
  ['lambda', 'aws lambda'],
  ['s3'],
  ['ec2'],
  ['ecs'],
  ['eks'],
  ['monitoring', 'observability'],
  ['devops'],
  ['sre', 'site reliability'],
  // data / ML / AI
  ['machine learning', 'ml'],
  ['deep learning'],
  ['artificial intelligence', 'ai'],
  ['nlp', 'natural language processing'],
  ['computer vision'],
  ['tensorflow'],
  ['pytorch', 'torch'],
  ['keras'],
  ['scikit-learn', 'sklearn', 'scikit learn'],
  ['pandas'],
  ['numpy'],
  ['spark', 'apache spark', 'pyspark'],
  ['hadoop'],
  ['airflow', 'apache airflow'],
  ['dbt'],
  ['etl', 'elt'],
  ['data engineering'],
  ['data science'],
  ['data analysis', 'data analytics'],
  ['tableau'],
  ['power bi', 'powerbi'],
  ['looker'],
  ['llm', 'llms', 'large language models', 'large language model'],
  ['generative ai', 'genai', 'gen ai'],
  ['rag', 'retrieval augmented generation', 'retrieval-augmented generation'],
  ['langchain'],
  ['openai'],
  ['hugging face', 'huggingface'],
  ['mlops'],
  ['a/b testing', 'ab testing', 'a b testing'],
  ['statistics', 'statistical analysis', 'statistical modeling'],
  ['data visualization'],
  ['data warehouse', 'data warehousing'],
  ['data pipelines', 'data pipeline'],
  ['feature engineering'],
  ['xgboost'],
  // mobile
  ['ios'],
  ['android'],
  ['react native'],
  ['flutter'],
  ['mobile development', 'mobile apps'],
  // testing
  ['jest'],
  ['cypress'],
  ['playwright'],
  ['selenium'],
  ['pytest'],
  ['junit'],
  ['unit testing', 'unit tests'],
  ['integration testing', 'integration tests'],
  ['tdd', 'test driven development', 'test-driven development'],
  ['e2e testing', 'end-to-end testing', 'end to end testing'],
  ['qa', 'quality assurance'],
  // practices / collaboration
  ['agile', 'agile methodologies', 'agile methodology'],
  ['scrum'],
  ['kanban'],
  ['jira'],
  ['confluence'],
  ['code review', 'code reviews'],
  ['design patterns'],
  ['oop', 'object-oriented programming', 'object oriented programming', 'object-oriented design'],
  ['functional programming'],
  ['distributed systems'],
  ['system design', 'systems design'],
  ['scalability', 'scalable systems'],
  ['performance optimization', 'performance tuning'],
  // bare "security" would match "social security" / "security clearance" boilerplate
  ['application security', 'cybersecurity', 'secure coding'],
  ['debugging', 'troubleshooting'],
  ['technical documentation'],
  ['mentoring', 'mentorship'],
  ['cross-functional', 'cross functional'],
  ['stakeholder management'],
  ['communication', 'communication skills'],
  ['problem solving', 'problem-solving'],
  ['leadership', 'team leadership'],
];

/** Longest alias length in words — bounds the n-gram scan. */
const MAX_SKILL_WORDS = 4;

const ALIAS_TO_CANONICAL = new Map<string, string>();
for (const group of SKILL_GROUPS) {
  for (const alias of group) ALIAS_TO_CANONICAL.set(alias, group[0]);
}

/** Register the user's own Settings→Skills as first-class lexicon entries so a
 *  skill we don't curate (e.g. "verilog") still counts. Returns their canonicals. */
function addUserSkills(skills: string[]): string[] {
  const canonicals: string[] = [];
  for (const raw of skills) {
    const s = (raw || '').trim().toLowerCase();
    if (!s) continue;
    const canonical = ALIAS_TO_CANONICAL.get(s) ?? s;
    if (!ALIAS_TO_CANONICAL.has(s)) ALIAS_TO_CANONICAL.set(s, canonical);
    canonicals.push(canonical);
  }
  return canonicals;
}

// ── Skill extraction ─────────────────────────────────────────────────────────

/** Lowercased word stream INCLUDING stopwords ("ruby on rails" needs "on"). */
function rawWords(text: string): string[] {
  return (text || '').toLowerCase().match(/[a-z0-9][a-z0-9+#./-]*/g) ?? [];
}

/** Normalize a candidate gram the same way aliases are stored. */
function normGram(words: string[]): string {
  return words.join(' ').replace(/\.+$/, '');
}

/**
 * Greedy longest-match scan of a text for lexicon skills. Longer grams win and
 * consume their words ("react native" does not also count as "react").
 * Returns canonical → occurrence count.
 */
export function findSkills(text: string): Map<string, number> {
  const words = rawWords(text);
  const found = new Map<string, number>();
  let i = 0;
  while (i < words.length) {
    let matched = false;
    for (let n = MAX_SKILL_WORDS; n >= 1; n--) {
      if (i + n > words.length) continue;
      const gram = normGram(words.slice(i, i + n));
      const canonical = ALIAS_TO_CANONICAL.get(gram);
      if (canonical) {
        found.set(canonical, (found.get(canonical) ?? 0) + 1);
        i += n;
        matched = true;
        break;
      }
    }
    if (!matched) i++;
  }
  return found;
}

// ── JD structure: required vs nice-to-have sections ──────────────────────────

const REQUIRED_HEADER = /\b(?:requirements?|required|must[- ]haves?|minimum qualifications?|basic qualifications?|qualifications|what (?:you|you'll|we) (?:need|require|look for)|what we'?re looking for|you (?:have|bring)|essential)\b/;
const PREFERRED_HEADER = /\b(?:preferred|nice[- ]to[- ]haves?|bonus|plus(?:es)?|desired|ideal(?:ly)?|good to have|would be (?:a )?(?:plus|great)|extra credit)\b/;

type Section = 'none' | 'required' | 'preferred';

/** Walk the JD line by line and label each skill with the strongest section it
 *  appears in (required beats preferred beats none). Also returns frequency. */
function extractJdSkills(text: string): { freq: Map<string, number>; section: Map<string, Section> } {
  const freq = new Map<string, number>();
  const section = new Map<string, Section>();
  let current: Section = 'none';
  for (const line of text.split('\n')) {
    const lower = line.toLowerCase();
    // Header lines are short; a requirement bullet mentioning "required" also counts.
    if (PREFERRED_HEADER.test(lower)) current = 'preferred';
    else if (REQUIRED_HEADER.test(lower)) current = 'required';
    const lineSection: Section = current;
    for (const [canonical, count] of findSkills(lower)) {
      freq.set(canonical, (freq.get(canonical) ?? 0) + count);
      const prev = section.get(canonical) ?? 'none';
      if (lineSection === 'required' || prev === 'required') section.set(canonical, 'required');
      else if (lineSection === 'preferred' && prev === 'none') section.set(canonical, 'preferred');
      else if (!section.has(canonical)) section.set(canonical, lineSection);
    }
  }
  return { freq, section };
}

// ── Title alignment ──────────────────────────────────────────────────────────

/** Words that describe level/arrangement, not the role itself. */
const TITLE_NOISE = new Set<string>([
  'senior', 'sr', 'junior', 'jr', 'lead', 'staff', 'principal', 'associate', 'mid', 'entry',
  'level', 'i', 'ii', 'iii', 'iv', 'v', '1', '2', '3', '4', '5', 'remote', 'hybrid', 'onsite',
  'on-site', 'contract', 'contractor', 'freelance', 'part-time', 'full-time', 'intern',
  'internship', 'new', 'grad', 'graduate', 'urgent', 'hiring', 'immediate', 'w2', 'usa', 'us',
]);

/** Role words that mean the same thing across titles. */
const TITLE_SYNONYM_GROUPS: string[][] = [
  ['engineer', 'developer', 'programmer', 'swe', 'engineering', 'development'],
  ['frontend', 'front-end'],
  ['backend', 'back-end'],
  ['fullstack', 'full-stack'],
  ['architect', 'architecture'],
  ['analyst', 'analytics', 'analysis'],
  ['scientist', 'science'],
  ['manager', 'management'],
];
const TITLE_CANONICAL = new Map<string, string>();
for (const group of TITLE_SYNONYM_GROUPS) {
  for (const alias of group) TITLE_CANONICAL.set(alias, group[0]);
}

/** Join the compounds that appear written three ways ("front end" / "front-end" /
 *  "frontend") into one token so both sides tokenize identically. */
export function joinCompounds(text: string): string {
  return text
    .replace(/\bfront[- ]end\b/gi, 'frontend')
    .replace(/\bback[- ]end\b/gi, 'backend')
    .replace(/\bfull[- ]stack\b/gi, 'fullstack');
}

function canonTitleWord(w: string): string {
  return TITLE_CANONICAL.get(w) ?? ALIAS_TO_CANONICAL.get(w) ?? w;
}

function titleTokens(title: string): string[] {
  return rawWords(joinCompounds(title))
    .map((w) => w.replace(/\.+$/, ''))
    .filter((w) => w.length >= 1 && !STOPWORDS.has(w) && !TITLE_NOISE.has(w))
    .map(canonTitleWord);
}

/** 0–100: how much of the job title's role vocabulary the résumé covers. Null when
 *  the title has no usable content words. The résumé term set must already be
 *  canonicalized with the same title synonyms (see atsMatchScores). */
export function titleAlignment(jobTitle: string, resumeTitleTerms: Set<string>): number | null {
  const toks = [...new Set(titleTokens(jobTitle))];
  if (toks.length === 0) return null;
  const hit = toks.filter((t) => resumeTitleTerms.has(t)).length;
  return Math.round((hit / toks.length) * 100);
}

// ── Requirement extraction: years, degree, clearance ─────────────────────────

/** Highest "N+ years" the posting asks for (null when it doesn't say). */
export function jdRequiredYears(text: string): number | null {
  let max: number | null = null;
  for (const m of text.matchAll(/(\d{1,2})\s*\+?\s*(?:years?|yrs?)\b/gi)) {
    const n = Number(m[1]);
    if (n >= 1 && n <= 20 && (max === null || n > max)) max = n;
  }
  return max;
}

const MONTH = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?';
// "2019 – 2023", "Jan 2021 to Mar 2023", "03/2021 - 04/2023", "2021 to Present"
const DATE_RANGE = new RegExp(
  `\\b(19\\d\\d|20\\d\\d)\\s*(?:[-–—]|to)\\s*(?:${MONTH}\\s*)?(?:\\d{1,2}\\/)?(19\\d\\d|20\\d\\d|present|current|now)\\b`,
  'gi',
);

/** Rough career span evidenced by the résumé's date ranges (null when none found). */
export function resumeYearsOfExperience(text: string, now = new Date()): number | null {
  let earliest: number | null = null;
  let latest: number | null = null;
  for (const m of text.matchAll(DATE_RANGE)) {
    const start = Number(m[1]);
    const end = /^\d/.test(m[2]) ? Number(m[2]) : now.getFullYear();
    if (end < start) continue;
    if (earliest === null || start < earliest) earliest = start;
    if (latest === null || end > latest) latest = end;
  }
  if (earliest === null || latest === null) return null;
  return Math.min(30, latest - earliest);
}

const ADVANCED_DEGREE = /\b(?:master'?s?|m\.s\.?|msc|mba|ph\.?d|doctorate)\b/i;

/** True when a line demands an advanced degree (not just "preferred"). */
export function requiresAdvancedDegree(text: string): boolean {
  for (const line of text.split('\n')) {
    if (ADVANCED_DEGREE.test(line) && /\b(?:required|must)\b/i.test(line) && !/preferred|plus|bonus|or equivalent|nice/i.test(line)) {
      return true;
    }
  }
  return false;
}

/** Mirrors the LLM scorer's hard block (ADR 0038): clearance / citizenship-
 *  restricted postings the candidate cannot be considered for. */
export function clearanceRestricted(text: string): boolean {
  return /\b(?:(?:active|secret|top.secret|security)\s+clearance|ts\/?sci|q clearance|public trust|us citizenship (?:is )?required|must be (?:a )?u\.?s\.? citizen|green card holders? only|permanent resident required|itar|us persons? only)\b/i.test(
    text,
  );
}

// ── The combined ATS match score ─────────────────────────────────────────────

const WEIGHTS = { skills: 0.55, title: 0.15, keywords: 0.3 };

export interface AtsResumeInput {
  /** Plain-text résumé (already flattened from the structured base résumé). */
  text: string;
  /** The user's Settings→Skills list (ADR 0018) — counted as résumé skills. */
  skills?: string[];
}

export interface AtsJobInput {
  id: string;
  title: string;
  /** Job description; may contain HTML (it is stripped here). */
  text: string;
}

export interface AtsMatchResult {
  score: number;
  breakdown: AtsMatchBreakdown;
}

/**
 * Score each job 0–100 against the résumé, ATS-style. IDF for the keywords
 * component is built across the résumé plus all supplied jobs, so job-board
 * boilerplate is downweighted relative to this batch. Returns an empty map when
 * the résumé is empty (caller treats as "no score" → not filtered).
 */
export function atsMatchScores(resume: AtsResumeInput, jobs: AtsJobInput[]): Map<string, AtsMatchResult> {
  const result = new Map<string, AtsMatchResult>();
  const resumeText = joinCompounds(stripHtml(resume.text || ''));
  const resumeTokens = tokenize(resumeText);
  if (resumeTokens.length === 0 || jobs.length === 0) return result;

  // Résumé side: lexicon skills found in the text + the user's declared skills.
  const userCanonicals = addUserSkills(resume.skills ?? []);
  const resumeSkills = new Set<string>([...findSkills(resumeText).keys(), ...userCanonicals]);
  const resumeTerms = new Set<string>([...resumeTokens, ...resumeSkills]);
  // Canonicalized copy for title matching (developer≈engineer on both sides).
  const resumeTitleTerms = new Set<string>([...resumeTerms].map(canonTitleWord));
  const resumeYears = resumeYearsOfExperience(resumeText);
  const resumeHasAdvancedDegree = ADVANCED_DEGREE.test(resumeText);

  // Keywords component: v1 IDF coverage over the stripped texts. IDF needs a
  // corpus — with only a couple of docs, terms shared with the résumé all get
  // weight 0 and the component degenerates to ~0. Below MIN_IDF_BATCH the
  // component is null and its weight moves to skills/title (this is how the
  // single-job tailored-résumé ATS check stays comparable).
  const MIN_IDF_BATCH = 5;
  const useKeywords = jobs.length >= MIN_IDF_BATCH;
  const jobTexts = jobs.map((j) => joinCompounds(stripHtml(`${j.title ?? ''}\n${j.text ?? ''}`)));
  const jobTokens = jobTexts.map((t) => tokenize(t));
  const idf = computeIdf([resumeTokens, ...jobTokens]);

  jobs.forEach((job, i) => {
    const text = jobTexts[i];
    const keywords = useKeywords ? Math.round(coverageScore(resumeTerms, jobTokens[i], idf) * 100) : null;

    // Skills component: weighted coverage of the JD's extracted skills.
    const { freq, section } = extractJdSkills(text);
    const titleSkills = new Set(findSkills(stripHtml(job.title ?? '')).keys());
    let denom = 0;
    let numer = 0;
    const weighted: { skill: string; w: number; hit: boolean }[] = [];
    for (const [skill, count] of freq) {
      const sec = section.get(skill) ?? 'none';
      let w = sec === 'required' ? 1.6 : sec === 'preferred' ? 0.6 : 1;
      if (titleSkills.has(skill)) w *= 1.5;
      w *= 1 + 0.25 * Math.min(count - 1, 3);
      const hit = resumeSkills.has(skill);
      denom += w;
      if (hit) numer += w;
      weighted.push({ skill, w, hit });
    }
    const skills = denom > 0 ? Math.round((numer / denom) * 100) : null;
    weighted.sort((a, b) => b.w - a.w);
    const matched = weighted.filter((x) => x.hit).map((x) => x.skill).slice(0, 12);
    const missing = weighted.filter((x) => !x.hit).map((x) => x.skill).slice(0, 12);

    const title = titleAlignment(job.title ?? '', resumeTitleTerms);

    // Weighted blend; a null component's weight is redistributed to the others.
    let sum = 0;
    let wsum = 0;
    for (const [key, value] of [['skills', skills], ['title', title], ['keywords', keywords]] as const) {
      if (value === null) continue;
      sum += value * WEIGHTS[key];
      wsum += WEIGHTS[key];
    }
    let score = wsum > 0 ? sum / wsum : 0;

    // Penalties.
    const flags: string[] = [];
    const needYears = jdRequiredYears(text);
    if (needYears !== null && resumeYears !== null && needYears - resumeYears >= 2) {
      score -= Math.min(15, 4 * (needYears - resumeYears - 1));
      flags.push(`asks ${needYears}+ yrs experience (résumé shows ~${resumeYears})`);
    }
    if (requiresAdvancedDegree(text) && !resumeHasAdvancedDegree) {
      score -= 8;
      flags.push('advanced degree required');
    }

    let final = Math.max(0, Math.min(100, Math.round(score)));
    if (clearanceRestricted(text)) {
      final = Math.min(final, 5);
      flags.push('clearance / citizenship restriction');
    }

    result.set(job.id, {
      score: final,
      breakdown: { skills, title, keywords, matched, missing, flags, v: 2 },
    });
  });
  return result;
}
