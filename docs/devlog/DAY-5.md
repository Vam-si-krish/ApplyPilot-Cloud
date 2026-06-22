# Devlog — Day 5 (2026-06-22) · START HERE for the new session

This session ended to save tokens. Below is the full current state + what to do next.

## ▶ NEXT BIG FEATURE (the plan to build): custom per-job résumés
**Read [docs/adr/0024-custom-resume-generation.md](../adr/0024-custom-resume-generation.md) — it is the full,
agreed spec.** Summary of the locked decisions:
- New **Applications** section: select/shortlist jobs → "Add to Applications" → generate a **job-tailored
  résumé** → preview/edit/download/apply.
- **Front-end stays on Netlify**; the user's **always-on MacBook runs a "résumé worker"** (Node/Express +
  **Puppeteer**) exposed via **Cloudflare Tunnel**. Worker does AI tailoring + PDF render + uploads to
  Supabase Storage (`resumes` bucket).
- **PDF = Puppeteer + HTML/CSS** with **auto-fit-to-ONE-page** (binary-search font/line-height/margins down
  to a ~9.5pt floor) and **ATS-readable** output (selectable text, standard fonts, single-column).
- **AI tailoring = rewrite the user's REAL bullets** to match each job (truthful, never fabricate),
  structured JSON, using the scoring-v2 signals we already store (`score_breakdown.missing`,
  `score_keywords`). **Editable base résumé + per-job tweaks in-app.**
- **Start with Phase 1** (all in this repo, testable): migration (`profile.base_resume` jsonb +
  `applications` table + `resumes` Storage bucket), Applications tab, "Add to Applications" on Jobs, and the
  base-résumé editor (one-time parse of `profile.resume_text` → JSON Resume). The user asked to begin Phase 1.

## ✅ Shipped/committed this stretch (Days 3–5)
Gmail two-phase sync + live progress; Application Tracker (+ Easy-Apply vs company-portal segregation, all
job boards); search libraries (saved roles/locations); skill-match (`resumeKeywords`) + skill gate + bulk
"select all matching" workflow; filter overhaul (skill/contract/unassessed filters, active-filter chips,
load-more); scoring **v2** (weighted must-have rubric, seniority, `score_breakdown`, `employment_type`,
ADR 0022); contract flagging (badge + filter; company-assessment no longer demotes legit contract roles);
mobile-responsive shell; company **re-assess** (overwrites tier); **fetch fix** — URL-driven input, hard
`max_jobs_per_run` cap, selectable **fetch_mode** Precise/Broad (ADR 0023); Netlify scheduled functions
(`netlify/functions/`); app favicon. Latest commits on `main`: `a077fd6` (fetch), `abeef87` (mobile+reassess).

## ⚠ OPEN ITEMS / GOTCHAS for the new session
1. **DEPLOY:** app is on **Netlify** (it ignores `vercel.json`). Lots is committed on `main` but only goes
   live on **push → Netlify build**. The daily run uses **Netlify scheduled functions** (`netlify/functions/
   daily-run.mjs` @ `0 23 * * *` = 04:30 IST, `gmail-sync.mjs`) — need env `CRON_SECRET` +
   `NEXT_PUBLIC_APP_URL` set in Netlify, active after deploy. Until deployed, the live app runs older fetch
   code (so it may still over-fetch / ignore the 500 cap).
2. **SECURITY (still open):** `.claude/settings.json` (DB password) was committed to the **public** GitHub
   repo's history. It's now untracked + gitignored, but **the secret remains in history → rotate the
   Supabase DB password** (Project Settings → Database). The password is also reused as the user's default
   signup password → rotate that too.
3. **BUG (unresolved):** "jobs fetched >24h ago appear on the main page when no filter is selected." Code is
   correct (buildParams always sends `recency=recent`; API filters `discovered_at >= now()-24h`; commit
   `9d81e64` is deployed). Almost certainly a **data** cause — likely the same posting re-inserted as a NEW
   row (de-dup is by exact `url`; if the URL varies between runs it re-inserts with a fresh `discovered_at`).
   Needs a **read-only DB diagnostic** (user must approve): (a) `select min/max(discovered_at), count(*) from
   jobs where discovered_at >= now()-interval '24 hours';` (b) duplicate check by `title,company`. Fix is
   likely tightening de-dup.
4. **DB state already set (live):** `max_jobs_per_run=500`, `fetch_mode=url`, `schedule_time=04:30`/
   `timezone=Asia/Kolkata`; `profile.resume_text` updated to the user's current PDF résumé. Skill-match
   `settings.skills` was NOT synced to the résumé (offered, not done).
5. **DB access etiquette:** the user wants explicit approval before any Supabase access. Migrations are
   applied manually via psql (password in `.claude/settings.json`, which is gitignored — never commit it).

## Migrations applied to the live DB through Day 5
0011 (mail pending) · 0012 (location_limits) · 0013 (search libraries) · 0014 (skill_match) · 0015 (skill
gate + cap) · 0016 (apply_source) · 0017 (scoring v2) · 0018 (fetch_mode). Next up: the résumé feature's
migration (Phase 1 of ADR 0024).
