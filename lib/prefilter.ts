/**
 * Pre-scoring relevance filter (ADR 0008). A cheap, local, no-API estimate of how
 * well the résumé matches a job, used to gate which jobs reach the LLM scorer.
 *
 * Metric: IDF-weighted coverage of the job's terms by the résumé — i.e. of the
 * job description's meaningful vocabulary (weighted by inverse document frequency
 * so boilerplate counts for little), what fraction also appears in the résumé:
 *
 *     match = Σ idf(t) for t ∈ (JD_terms ∩ resume_terms)  /  Σ idf(t) for t ∈ JD_terms
 *
 * Deterministic and dependency-free. All functions here are pure so they can be
 * unit-tested without a DB or network.
 */

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

export interface PrefilterInput {
  id: string;
  text: string;
}

/**
 * Score each job 0–100 against the résumé. IDF is built across the résumé plus
 * all the supplied jobs, so common boilerplate is downweighted relative to this
 * batch. Returns an empty map when the résumé is empty (caller treats as "no
 * score" → not filtered).
 */
export function prefilterScores(resumeText: string, jobs: PrefilterInput[]): Map<string, number> {
  const result = new Map<string, number>();
  const resumeTokens = tokenize(resumeText);
  if (resumeTokens.length === 0 || jobs.length === 0) return result;

  const jobTokens = jobs.map((j) => tokenize(j.text));
  const idf = computeIdf([resumeTokens, ...jobTokens]);
  const resumeSet = new Set(resumeTokens);

  jobs.forEach((j, i) => {
    const pct = Math.round(coverageScore(resumeSet, jobTokens[i], idf) * 100);
    result.set(j.id, Math.max(0, Math.min(100, pct)));
  });
  return result;
}
