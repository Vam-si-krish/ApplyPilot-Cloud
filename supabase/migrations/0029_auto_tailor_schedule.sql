-- 0029_auto_tailor_schedule.sql
-- Scheduled overnight résumé tailoring (ADR 0043). The user selects jobs in Tailor &
-- Apply (status 'queued'), and a nightly cron drains that queue on the always-on worker
-- — tailoring + scoring + PDF for each — so the heavy LLM usage is spent while the user
-- sleeps (e.g. 04:00, off the interactive Claude window) and the résumés are ready by
-- morning. Mirrors the existing schedule_time / auto_scrape_enabled pattern.
alter table settings add column if not exists auto_tailor_enabled boolean not null default false;
-- 'HH:MM' wall-clock in the settings timezone (reuses settings.timezone). Cron fires
-- hourly and the route only acts when the local hour matches (DST-safe; see ADR 0043).
alter table settings add column if not exists auto_tailor_time text not null default '04:00';
