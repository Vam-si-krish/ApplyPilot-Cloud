-- Duplicate-posting detection (ADR 0057). Employers blast one requisition across
-- many locations / re-post daily under new job ids; URL de-dup can't catch that.
-- content_key fingerprints the posting's content (company+title+stripped body,
-- computed in lib/dedupe.ts — the SINGLE implementation; backfilled by script);
-- duplicate_of links later copies to the first-seen canonical row.
alter table jobs add column if not exists content_key text;
alter table jobs add column if not exists duplicate_of uuid references jobs(id) on delete set null;
create index if not exists jobs_content_key_idx on jobs(content_key) where content_key is not null;
create index if not exists jobs_duplicate_of_idx on jobs(duplicate_of) where duplicate_of is not null;
