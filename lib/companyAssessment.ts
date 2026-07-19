/**
 * Per-company assessment (ADR 0101).
 *
 * Replaces the per-job COMPANY_TIER that rode the scoring call (ADR 0065): a
 * company's identity does not change between postings, so judging it on every
 * posting produced contradictory verdicts and paid for the same judgment
 * hundreds of times. Each company is now assessed ONCE — one batched LLM call
 * covers up to ASSESS_COMPANIES_PER_CALL companies — on two orthogonal axes:
 *
 *   apply_channel — who actually receives the application (the waste-of-time
 *                   axis: aggregator / talent_marketplace / gig_platform).
 *   trust         — employer legitimacy; 'suspicious' needs concrete signals.
 *
 * Verdicts live in the shared company_assessments table and are denormalized
 * onto jobs (apply_channel/company_trust) by the apply_company_assessments SQL
 * function so list filtering stays plain column filters. Scoring discipline is
 * unchanged: still exactly one scoring call per job; an assessment failure
 * leaves the company visibly unassessed — never a fabricated verdict.
 */

import { getClient, ChatMessage, LLMClient } from './llm';
import { stripHtml } from './prefilter';
import { supabaseAdmin } from './supabase';
import type { ApplyChannel, CompanyAssessment, CompanyTrust, Job } from './types';

export const APPLY_CHANNELS: ApplyChannel[] = [
  'direct', 'staffing', 'aggregator', 'talent_marketplace', 'gig_platform', 'unknown',
];
export const COMPANY_TRUSTS: CompanyTrust[] = ['established', 'plausible', 'suspicious', 'unknown'];

/** Channels whose applications never reach the named role's employer directly —
 *  the "hide time-wasters" filter set (trust='suspicious' is added separately). */
export const TIME_WASTER_CHANNELS: ApplyChannel[] = ['aggregator', 'talent_marketplace', 'gig_platform'];

/** Companies per LLM call. Big enough to amortize the prompt, small enough that
 *  one malformed response never strands many companies. */
export const ASSESS_COMPANIES_PER_CALL = 15;

/**
 * Normalize a company name into the shared cache key. MUST stay in lockstep with
 * the SQL backfill in supabase/migrations/0053_company_assessments.sql:
 * collapse whitespace, trim, lowercase.
 */
export function normalizeCompanyKey(name: string | null | undefined): string | null {
  const key = (name ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  return key || null;
}

// ── Prompt ───────────────────────────────────────────────────────────────────

export const COMPANY_ASSESS_PROMPT = `You are assessing the ORGANIZATIONS behind job postings — not the jobs themselves, and not any candidate. For each company you answer two independent questions.

QUESTION 1 — APPLY_CHANNEL: when a candidate applies to this organization's posting, who actually receives them? Use what you KNOW about the organization plus the sample posting. Exactly one of:
  direct             — this organization is the hiring employer. Company size is irrelevant; an unknown 5-person startup hiring for itself is 'direct'. Sending applicants to its own external ATS / career site (Workday, Greenhouse, iCIMS, Lever, Ashby, …) is completely normal and still 'direct'.
  staffing           — a staffing/recruiting agency or consultancy filling a role for a real client company (e.g. Insight Global, Robert Half, Motion Recruitment).
  aggregator         — a job board / matching / auto-apply platform REPOSTING another company's opening behind its own signup funnel; the real opening lives elsewhere (e.g. Jobgether, Lensa, Jobright.ai). Repost signals: "on behalf of a partner company", the true employer's name withheld, or the organization's own product is job search/matching.
  talent_marketplace — "applying" actually means joining the platform's vetted talent pool (assessments, AI interviews, profile review) rather than applying to the named role (e.g. Turing, micro1, Crossover, Braintrust, Toptal).
  gig_platform       — a piecework/task platform (data labeling, AI training, microtasks) recruiting workers through postings styled as jobs (e.g. DataAnnotation, Alignerr, Outlier).
  unknown            — you genuinely cannot tell from the name and the posting.
Classify the channel CONFIDENTLY — naming a company an aggregator is a factual classification, not an accusation. When the organization's own business is job matching, auto-apply, talent pools, or task work, say so.

QUESTION 2 — TRUST: how much reason is there to believe this is a legitimate organization? Exactly one of:
  established — a well-known, reputable, or clearly real organization (including reputable staffing firms and reputable marketplaces).
  plausible   — looks like a real organization but is unremarkable or thinly documented.
  suspicious  — concrete scheme signals ONLY: fees to apply, résumé-upsell, data harvesting, fake/shell identity, bait postings. BE CONSERVATIVE here — never 'suspicious' merely for being small, unrecognized, a staffing firm, contract work, or requiring an ATS account.
  unknown     — not enough information; DO NOT GUESS.
Never invent facts about an organization. Trust may be 'unknown' while the channel is still confidently classified from the posting itself.

NOTE: one concise sentence per company. For a non-direct channel, say where the real opening likely lives or what applying actually gets the candidate into.

You will receive numbered companies. RESPOND IN EXACTLY THIS FORMAT for EVERY company, in order, nothing else:
COMPANY 1
APPLY_CHANNEL: [direct|staffing|aggregator|talent_marketplace|gig_platform|unknown]
TRUST: [established|plausible|suspicious|unknown]
NOTE: [one sentence]
COMPANY 2
...`;

/** What the assessor needs to know about one company. */
export interface CompanyCandidate {
  company_key: string;
  /** Display name as scraped (pre-normalization). */
  name: string;
  company_size?: string | null;
  /** A representative posting: title + description excerpt give the model the
   *  posting-level repost/pool/task signals the name alone may not carry. */
  sample_title?: string | null;
  sample_description?: string | null;
}

export interface CompanyVerdict {
  company_key: string;
  display_name: string;
  apply_channel: ApplyChannel;
  trust: CompanyTrust;
  note: string | null;
}

/** Build the two-message prompt for one batch of companies. */
export function buildAssessMessages(candidates: CompanyCandidate[]): ChatMessage[] {
  const blocks = candidates.map((c, i) => {
    const excerpt = stripHtml(c.sample_description ?? '').slice(0, 1200);
    return (
      `COMPANY ${i + 1}\n` +
      `NAME: ${c.name}\n` +
      `SIZE: ${c.company_size ?? 'N/A'}\n` +
      `SAMPLE POSTING TITLE: ${c.sample_title ?? 'N/A'}\n` +
      `SAMPLE POSTING EXCERPT: ${excerpt || 'N/A'}`
    );
  });
  return [
    { role: 'system', content: COMPANY_ASSESS_PROMPT },
    { role: 'user', content: `Assess these ${candidates.length} companies:\n\n${blocks.join('\n\n')}` },
  ];
}

/**
 * Parse one batch response. Line-prefixed and defensive like parseScoreResponse:
 * an invalid enum falls back to 'unknown'; a company block the model skipped or
 * mangled (no APPLY_CHANNEL line) is simply absent from the result and stays
 * unassessed — never a fabricated verdict.
 */
export function parseAssessResponse(response: string, candidates: CompanyCandidate[]): CompanyVerdict[] {
  const drafts = new Map<number, Partial<CompanyVerdict>>();
  let current: Partial<CompanyVerdict> | null = null;

  for (const raw of response.split('\n')) {
    const line = raw.trim();
    const upper = line.toUpperCase();
    const header = upper.match(/^COMPANY\s+(\d+)\b/);
    if (header) {
      const idx = parseInt(header[1], 10) - 1;
      if (idx >= 0 && idx < candidates.length) {
        current = drafts.get(idx) ?? {};
        drafts.set(idx, current);
      } else {
        current = null; // out-of-range index — ignore the whole block
      }
    } else if (current && upper.startsWith('APPLY_CHANNEL:')) {
      const v = line.slice(14).trim().toLowerCase().replace(/[^a-z_]/g, '');
      current.apply_channel = (APPLY_CHANNELS as string[]).includes(v) ? (v as ApplyChannel) : 'unknown';
    } else if (current && upper.startsWith('TRUST:')) {
      const v = line.slice(6).trim().toLowerCase().replace(/[^a-z]/g, '');
      current.trust = (COMPANY_TRUSTS as string[]).includes(v) ? (v as CompanyTrust) : 'unknown';
    } else if (current && upper.startsWith('NOTE:')) {
      current.note = line.slice(5).trim() || null;
    }
  }

  const verdicts: CompanyVerdict[] = [];
  for (const [idx, draft] of drafts) {
    if (!draft.apply_channel) continue; // mangled block — leave unassessed
    const c = candidates[idx];
    verdicts.push({
      company_key: c.company_key,
      display_name: c.name,
      apply_channel: draft.apply_channel,
      trust: draft.trust ?? 'unknown',
      note: draft.note ?? null,
    });
  }
  return verdicts;
}

/**
 * Assess companies via the scoring-lane LLM (cheap, high-volume task). Batches of
 * ASSESS_COMPANIES_PER_CALL; a failed batch is logged and skipped (its companies
 * stay unassessed and are retried on a later pass).
 */
export async function assessCompanies(
  candidates: CompanyCandidate[],
  client?: LLMClient,
): Promise<CompanyVerdict[]> {
  const llm = client ?? getClient();
  const verdicts: CompanyVerdict[] = [];
  for (let i = 0; i < candidates.length; i += ASSESS_COMPANIES_PER_CALL) {
    const batch = candidates.slice(i, i + ASSESS_COMPANIES_PER_CALL);
    try {
      const response = await llm.chat(buildAssessMessages(batch), {
        maxTokens: Math.min(4000, 200 + 150 * batch.length),
        temperature: 0.1,
      });
      verdicts.push(...parseAssessResponse(response, batch));
    } catch (e) {
      console.error('[company-assessment] batch failed:', e instanceof Error ? e.message : String(e));
    }
  }
  return verdicts;
}

// ── DB orchestration ─────────────────────────────────────────────────────────

/** The provider/model recorded on rows this client produces (best-effort). */
function clientLabel(client?: LLMClient): string | null {
  if (!client) return null;
  const c = client as unknown as { provider?: string; model?: string };
  return [c.provider, c.model].filter(Boolean).join('/') || null;
}

/** Persist verdicts. ignoreDuplicates: an existing row (possibly carrying a user
 *  override) is authoritative — concurrent chunks must never clobber it. */
export async function insertCompanyAssessments(
  verdicts: CompanyVerdict[],
  client?: LLMClient,
): Promise<void> {
  if (verdicts.length === 0) return;
  const model = clientLabel(client);
  const rows = verdicts.map((v) => ({ ...v, model }));
  const { error } = await supabaseAdmin()
    .from('company_assessments')
    .upsert(rows, { onConflict: 'company_key', ignoreDuplicates: true });
  if (error) throw new Error(`persist company assessments: ${error.message}`);
}

/** Stamp jobs with their company's effective verdict (override-first). Under a
 *  user-scoped request RLS confines the update to the caller's own rows. */
export async function stampJobsFromAssessments(keys: string[] | null): Promise<number> {
  const { data, error } = await supabaseAdmin().rpc('apply_company_assessments', { keys });
  if (error) throw new Error(`stamp jobs from assessments: ${error.message}`);
  return typeof data === 'number' ? data : 0;
}

/** Deduplicate job rows into one assessment candidate per company key. */
export function collectCandidates(jobs: Pick<Job, 'company' | 'company_size' | 'title' | 'full_description'>[]): CompanyCandidate[] {
  const byKey = new Map<string, CompanyCandidate>();
  for (const job of jobs) {
    const key = normalizeCompanyKey(job.company);
    if (!key || byKey.has(key)) continue;
    byKey.set(key, {
      company_key: key,
      name: (job.company ?? '').trim(),
      company_size: job.company_size ?? null,
      sample_title: job.title ?? null,
      sample_description: job.full_description ?? null,
    });
  }
  return [...byKey.values()];
}

/**
 * Make sure every company appearing in `jobs` has an assessment, then stamp the
 * verdicts onto jobs. Called from the scoring runner (new companies arrive with
 * new postings) and the backfill route. Returns how many companies were newly
 * assessed. Any failure here must never block scoring — callers guard it.
 */
export async function ensureCompanyAssessments(
  jobs: Pick<Job, 'company' | 'company_size' | 'title' | 'full_description'>[],
  client?: LLMClient,
): Promise<number> {
  const candidates = collectCandidates(jobs);
  if (candidates.length === 0) return 0;
  const keys = candidates.map((c) => c.company_key);

  const { data: existing, error } = await supabaseAdmin()
    .from('company_assessments')
    .select('company_key')
    .in('company_key', keys);
  if (error) throw new Error(`load existing assessments: ${error.message}`);
  const known = new Set((existing ?? []).map((r) => (r as { company_key: string }).company_key));

  const missing = candidates.filter((c) => !known.has(c.company_key));
  let assessed = 0;
  if (missing.length > 0) {
    const verdicts = await assessCompanies(missing, client);
    await insertCompanyAssessments(verdicts, client);
    assessed = verdicts.length;
  }

  // Stamp every key we touched — covers rows inserted before their company's
  // verdict existed, not just the newly assessed ones.
  await stampJobsFromAssessments(keys);
  return assessed;
}

/** Effective verdict of one assessment row (user override wins). */
export function effectiveVerdict(a: CompanyAssessment): { apply_channel: ApplyChannel; trust: CompanyTrust } {
  return {
    apply_channel: a.override_channel ?? a.apply_channel,
    trust: a.override_trust ?? a.trust,
  };
}
