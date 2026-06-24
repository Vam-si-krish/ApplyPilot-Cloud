-- 0026_cover_letter.sql
-- Per-application cover letter (generated on demand from the base résumé + job, then
-- rendered to a downloadable PDF — parallel to the tailored résumé). Three columns:
--   cover_letter          — the generated letter text (also lets us re-render later)
--   cover_letter_pdf_path — storage path of the rendered PDF in the `resumes` bucket
--   cover_letter_error    — last generation/render error (null on success), for the UI
alter table applications add column if not exists cover_letter          text;
alter table applications add column if not exists cover_letter_pdf_path text;
alter table applications add column if not exists cover_letter_error     text;
