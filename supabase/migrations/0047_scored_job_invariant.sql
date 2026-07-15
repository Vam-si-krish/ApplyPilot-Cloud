-- A job is "scored" only when it has a numeric AI fit result. Historical manual
-- applications and archive restores could set status='scored' while fit_score was
-- NULL, making the dashboard report work the UI could not display.

update public.jobs
set status = 'unscored', scored_at = null
where status = 'scored' and fit_score is null;

alter table public.jobs drop constraint if exists jobs_scored_has_fit_score;
alter table public.jobs add constraint jobs_scored_has_fit_score
  check (status <> 'scored' or fit_score is not null);
