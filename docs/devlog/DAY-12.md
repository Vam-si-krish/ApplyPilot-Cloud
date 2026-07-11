# DAY 12 — 2026-07-11

## 🚨 Incident: site "acts like it's new" + revert of the ChatGPT episode

**Root cause of the outage: Supabase free-tier API restriction — `exceed_egress_quota`.**
Every REST call (from Netlify, from the browser, even with valid keys) returns the
restriction error, so the UI renders empty. **All data is intact** — verified over a
direct Postgres connection (4,072 jobs, 618 applications, profile/settings present).
Direct `psql` keeps working; only the API gateway (REST/Storage) is blocked.

**Likely egress driver:** an unrelated AI session building a friend's portfolio was
given this project's credentials by mistake. It created a **public** bucket
`neha-portfolio` in this project on **2026-07-10 04:20 UTC** and uses
`content.json` (43 kB) as the live portfolio's content store — i.e. an external
site's traffic (plus that session's build/test transfer) was metered against our
5 GB free-tier egress, on top of a month of our own PDF auto-downloads
(`resumes` bucket: 1,492 files / 226 MB). Exact attribution: Supabase dashboard →
Usage → Egress.

**Second, independent problem:** production was half-deployed. `d324e1d`
(ADR 0069, ChatGPT subscription + three AI lanes) was pushed to Netlify while its
migration `0042_chat_model.sql` was **never applied** — saving Settings writes
`chat_provider`/`chat_model` against a schema that doesn't have them. The Worker
Mac *was* redeployed to `d324e1d` (verified via `/version` through the quick-tunnel
URL in `settings.resume_worker_url`).

### Done today
- Reverted both ChatGPT-episode commits (`78fbc28` "15 to 45", `d324e1d` ADR 0069)
  in `7ec633c`; reverted tree verified **byte-identical to `896d623`** (last state
  proven good in prod, ran until Jul 10 04:03 UTC). Typecheck clean; 161 tests pass.
- Migration 0042: confirmed **not applied** → nothing to roll back in the DB; after
  the revert, code and schema match again. ADR 0070 records the revert.

### Pending (user decisions / other machines)
1. **Restore Supabase service:** upgrade to Pro (immediate) or wait for the monthly
   cycle reset. Until then the site stays empty-looking even after the revert.
2. **Evict the squatter:** move the friend's portfolio to her own Supabase project,
   then delete bucket `neha-portfolio` here (2 files, 43 kB — trivial to re-host).
3. **Rotate credentials** — they leaked into another project: DB password + API keys
   (anon/service role), then update Netlify env, Worker Mac `resume-worker/.env`,
   local `.env.local`, and the `PGPASSWORD` baked into `.claude/settings.json`.
4. **Worker Mac:** `git pull` + `npm install --prefix resume-worker` + kickstart to
   drop back to the reverted code (currently serves `d324e1d`; its legacy
   `subscription` path still serves the reverted app fine in the interim).
5. After service restores: drain the 96 unscored jobs; optionally mark the stale
   `running` runs (Jul 6–10) as failed.
