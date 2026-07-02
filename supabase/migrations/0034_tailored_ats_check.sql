-- Tailored-résumé ATS check (ADR 0053 addendum). After tailoring, the local
-- ATS scorer re-checks the TAILORED résumé against the job (no LLM — distinct
-- from the dropped tailored_fit_score, ADR 0050).
alter table applications add column if not exists tailored_match_score int;
alter table applications add column if not exists tailored_match_breakdown jsonb;
