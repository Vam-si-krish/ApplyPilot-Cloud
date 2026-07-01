-- 0032_allow_delete_scores.sql
-- Repurpose the re-scoring safety gate into a DELETE-scores gate (replaces ADR 0039's
-- allow_rescore). When on, the Jobs tab surfaces bulk actions to clear a job's fit score,
-- company score, match score, or tailored résumé. Renaming (not dropping+adding) preserves
-- the existing boolean value and keeps it a single toggle.
alter table settings rename column allow_rescore to allow_delete_scores;
