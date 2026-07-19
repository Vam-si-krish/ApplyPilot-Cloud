-- Company assessment v2 (ADR 0107): the per-job COMPANY_TIER conflated "is the
-- employer legit" with "does applying reach the employer", and judging the same
-- company independently on every posting produced contradictory tiers (one company
-- received all four tiers across 122 postings). Assess each COMPANY once on two
-- orthogonal axes — apply_channel (who receives the application) and trust
-- (legitimacy) — and denormalize the effective verdict onto jobs so list filtering
-- and pagination stay plain column filters.

create table if not exists public.company_assessments (
  company_key text primary key,
  display_name text not null,
  apply_channel text not null default 'unknown'
    check (apply_channel in ('direct','staffing','aggregator','talent_marketplace','gig_platform','unknown')),
  trust text not null default 'unknown'
    check (trust in ('established','plausible','suspicious','unknown')),
  note text,
  -- provider/model that produced the verdict, for auditing bad calls
  model text,
  assessed_at timestamptz not null default now(),
  -- User corrections win over the AI verdict and survive re-assessment.
  override_channel text
    check (override_channel in ('direct','staffing','aggregator','talent_marketplace','gig_platform','unknown')),
  override_trust text
    check (override_trust in ('established','plausible','suspicious','unknown')),
  updated_at timestamptz not null default now()
);

alter table public.company_assessments enable row level security;
alter table public.company_assessments force row level security;
drop policy if exists shared_assessment_policy on public.company_assessments;
-- Company verdicts hold no personal data; the three fixed accounts share one cache
-- so a company assessed for one user never costs a second LLM call for another.
create policy shared_assessment_policy on public.company_assessments
  using (true) with check (true);

alter table public.jobs add column if not exists company_key text;
alter table public.jobs add column if not exists apply_channel text;
alter table public.jobs add column if not exists company_trust text;

-- Normalization must stay in lockstep with normalizeCompanyKey() in
-- lib/companyAssessment.ts: collapse whitespace, trim, lowercase.
update public.jobs
  set company_key = nullif(lower(btrim(regexp_replace(company, '\s+', ' ', 'g'))), '')
  where company_key is null and company is not null;

create index if not exists jobs_company_key_idx on public.jobs (company_key);
create index if not exists jobs_apply_channel_idx on public.jobs (apply_channel);

-- Stamp jobs with the effective (override-first) verdict of their company.
-- SECURITY INVOKER on purpose: under a user-scoped request the jobs RLS policy
-- limits the update to the caller's own rows, which is exactly what each
-- per-user scoring/backfill pass should touch.
create or replace function public.apply_company_assessments(keys text[] default null)
returns integer language sql as $$
  with target as (
    select ca.company_key,
           coalesce(ca.override_channel, ca.apply_channel) as channel,
           coalesce(ca.override_trust, ca.trust) as trust
    from public.company_assessments ca
    where keys is null or ca.company_key = any(keys)
  ), updated as (
    update public.jobs j
    set apply_channel = t.channel, company_trust = t.trust
    from target t
    where j.company_key = t.company_key
      and (j.apply_channel is distinct from t.channel or j.company_trust is distinct from t.trust)
    returning j.id
  )
  select count(*)::int from updated;
$$;

notify pgrst, 'reload schema';
