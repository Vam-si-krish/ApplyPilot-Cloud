-- ATS-style match score v2 (ADR 0053). prefilter_score (0-100) now holds a
-- weighted skills/title/keywords match instead of plain IDF coverage; this
-- column stores the per-component breakdown so the UI can explain the number.
alter table jobs add column if not exists prefilter_breakdown jsonb;
