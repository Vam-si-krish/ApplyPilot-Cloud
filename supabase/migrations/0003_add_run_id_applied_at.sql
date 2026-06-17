-- Link each job to the run that discovered it (null for jobs ingested before this migration).
alter table jobs add column if not exists run_id uuid references runs(id) on delete set null;
create index if not exists jobs_run_id_idx on jobs (run_id);

-- Track when the user applied. Null = not applied; timestamp = applied at that time.
alter table jobs add column if not exists applied_at timestamptz;
create index if not exists jobs_applied_at_idx on jobs (applied_at);
