-- Tailored ATS check: persist the BASE résumé's single-job score next to the
-- tailored one (ADR 0053 addendum) so the row can show "base → tailored"
-- permanently, not just in the one-time toast.
alter table applications add column if not exists base_match_score int;
