# Devlog — Day 6 (2026-06-22) · START HERE for the new session

## ✅ Shipped this session: Phase 1 of the custom résumé feature (ADR 0024)
Built the foundation for per-job tailored résumés. All typechecks/tests/build are green
(`npm run typecheck && npm run test && npm run build`). **Nothing is live until deploy + migration.**

What landed:
- **Migration `0019_resume_applications.sql`** — `profile.base_resume jsonb`, the `applications` table
  (`job_id` unique FK, `status` queued|generating|ready|applied|failed, `template`, `tailored_resume jsonb`,
  `pdf_path`, `error`, timestamps), and the private `resumes` Storage bucket. **NOT YET APPLIED to the live DB.**
- **`lib/resume.ts`** — pure JSON Resume helpers: `emptyResume`, `normalizeResume` (defensive coercion of
  arbitrary/LLM JSON → well-formed `ResumeDoc`; flattens nested location, drops junk), `extractJsonObject`
  (balanced-brace JSON extraction from an LLM reply). Fully unit-tested (`lib/resume.test.ts`, 14 cases).
- **`lib/resumeParse.ts`** — `RESUME_PARSE_PROMPT` + `parseResumeText()`: a SINGLE bounded LLM call that
  STRUCTURES `resume_text` verbatim into JSON Resume (no fabrication — same discipline as the scorer).
  Serverless-safe (runs in a Netlify route; only the PDF render needs the worker later).
- **Types** (`lib/types.ts`): `ResumeDoc` (basics/work/education/skills/projects), `Application`,
  `ApplicationWithJob`, `ApplicationStatus`; `Profile.base_resume`.
- **`db.ts` helpers**: `getBaseResume`, `saveBaseResume`, `listApplications` (joins jobs), `addApplications`
  (idempotent upsert on `job_id`).
- **Routes**: `GET/PUT /api/base-resume`, `POST /api/base-resume/parse`, `GET/POST /api/applications`,
  `PATCH/DELETE /api/applications/[id]`. All session-gated (no middleware changes needed).
- **UI**: new **Applications** tab (`app/(app)/applications/page.tsx`) with two views — the applications
  list (status badge, mark-applied, open posting, remove) and the **Base résumé** editor
  (`components/BaseResumeEditor.tsx`: structured form + "Build/Rebuild from résumé text"). Nav entry added to
  `AppShell` (Briefcase→Jobs, **FileText→Applications**). **Add to Applications (N)** bulk button on the Jobs
  selection toolbar (violet), calls `POST /api/applications`.

## ✅ Also shipped this session: Phase 2 (AI tailoring) — migration 0019 APPLIED to the live DB
- **Migration `0019` is applied** to the live DB (verified: `profile.base_resume`, `applications` table +
  status CHECK, `resumes` bucket). The Applications tab works in prod once deployed.
- **`lib/resumeTailor.ts`** — `TAILOR_PROMPT` + `tailorResume()` (one LLM call) + the pure `mergeTailored()`:
  TWO layers of anti-fabrication. The prompt forbids inventing; `mergeTailored` enforces it structurally —
  employers/titles/dates/education and the SET of skills come from the BASE résumé (aligned by index), the
  model may only rephrase summary/highlights and re-order. Invented skills are dropped; if the model returns
  no real skills, fall back to base. Unit-tested in `lib/resumeTailor.test.ts` (8 cases).
- **`POST /api/applications/[id]/generate`** — loads the application's job + `base_resume` + scoring-v2 signals
  (`score_breakdown.missing`, `matched_skills`, `unmatched_skills`, `score_keywords`), tailors, writes
  `tailored_resume` + status `ready` (or `failed`+`error`). Serverless-safe (one LLM call).
- **UI**: per-application **Generate/Regenerate** button + an expandable, editable tailored-résumé panel.
  Refactored the editor body into a shared **`components/ResumeFields.tsx`** used by both the base editor and
  the per-application editor. Save edits via `PATCH /api/applications/[id]` (`tailored_resume`, normalized).
- **Local e2e verified** (dev server + real DB + DeepSeek): login → `/api/base-resume/parse` (parsed the
  user's real résumé: 3 roles w/ correct dates, 9 skill groups, 2 degrees) → add Alignerr job to Applications
  → generate. Result: **employers/dates preserved verbatim, ZERO invented skills**, summary/bullets reframed
  to the job. A sample application + the parsed `base_resume` are left in the live DB as a working example.
- **Total checks:** `typecheck` ✅, `test` ✅ (97 pass), `build` ✅.

## ✅ Also shipped this session: Phase 3 (the résumé worker) — verified end-to-end locally
- **`resume-worker/`** (isolated package, Node/Express + Puppeteer): `templates.js` (`classic` serif + `modern`
  sans — single-column, semantic `<h2>` sections, native list markers so the PDF **text stream matches reading
  order**), `render.js` (**auto-fit-to-one-page**: binary-search the largest `--scale` that renders a single
  page, using the real PDF page count via `pdf-lib`; ≈9pt floor; returns `tooLong` instead of spilling to page
  2), `supabase.js`, `server.js` (`POST /generate` + `GET /health`, Bearer `WORKER_SECRET`), `render-sample.js`,
  README. `npm install` pulls a headless Chromium (~150 MB) into `resume-worker/node_modules` (NOT the Next app).
- **App side**: `POST /api/applications/[id]/render` (proxies to the worker — Puppeteer can't run serverless),
  `GET /api/applications/[id]/pdf` (signed URL from the private `resumes` bucket), and the Applications UI now
  has a template selector + **Create/Re-render PDF** + **Download PDF**.
- **Tailoring tuned for one page**: `TAILOR_PROMPT` now caps total bullets (~10–13) and consolidates skills
  (≤6 groups) so the content fits one page; auto-fit is the safety net.
- **Verified locally end-to-end** (Next on :3000 + worker on :8787, live DB + DeepSeek): generate → render →
  upload → signed-URL download produced a clean **single-page** PDF (scale ≈0.88) — real employers/dates, zero
  invented skills, summary tailored to the job, selectable text in correct order. Read back the PDF to confirm.
- **Env**: `resume-worker/.env` (gitignored) holds `WORKER_SECRET` + Supabase service role; `.env.local` got
  `RESUME_WORKER_URL=http://localhost:8787` + `RESUME_WORKER_SECRET` (both gitignored). For Netlify (Phase 4)
  these become the tunnel URL + the same secret.

## ▶ NEXT: Phase 4 (the only thing left for ADR 0024)
- **Cloudflare Tunnel**: a turnkey kit is committed — `resume-worker/SETUP.md` (step-by-step) +
  `resume-worker/install-service.sh` (generates/loads the launchd plist so the worker runs on boot). On the
  server laptop: copy `resume-worker/`, `npm install`, set `.env`, `./install-service.sh`, then
  `cloudflared` named tunnel → `worker.vamsikrish.com → localhost:8787`. Put `RESUME_WORKER_URL` (tunnel URL) +
  `RESUME_WORKER_SECRET` into the **Netlify** env. Then the deployed app renders PDFs; until then, only local.
- **To run the full pipeline locally** in a fresh session: `cd resume-worker && npm start` (worker on :8787),
  then `npm run dev` at the repo root. The Applications tab's Generate → Create PDF → Download then works.

## ⚠ OPEN ITEMS / GOTCHAS (carried from Day 5 — still open)
1. ✅ **DONE — migration `0019` applied** to the live DB (2026-06-22). The user granted standing DB access:
   apply migrations via psql + push when sensible, only check in for *big* changes. Password still in the
   gitignored `.claude/settings.json` (never commit/echo it).
2. **DEPLOY:** app is on **Netlify** (ignores `vercel.json`). Everything committed only goes live on
   **push → Netlify build**. Day-5 work (500 cap, fetch modes, scoring v2, contract flags, mobile, reassess,
   4:30 IST schedule via `netlify/functions/`) + this Phase-1 work are all **undeployed**.
3. **SECURITY:** `.claude/settings.json` (DB password) was committed to the **public** repo history. Untracked +
   gitignored now, but the secret remains in history → **rotate the Supabase DB password** (also reused as the
   user's default signup password → rotate that too).
4. **BUG (diagnosed 2026-06-22 — it's deploy lag, not data):** ">24h jobs appear on the main page." Ran the
   read-only diagnostic on the live DB: data is **clean** — sharp 24h cutoff (1273 rows ≤24h, oldest ≈23.7h;
   3003 older) and the API filters exactly that column. So the live site is just running **older code**;
   **deploying fixes it.**
   - **Separate data-quality follow-up (NOT the same bug):** duplicates — 104 (title,company) groups / ~461 rows
     (~357 extra) within 24h, because de-dup is by exact `url` (varies across fetches / keyword×location combos).
     Repeats clutter the list. Recommended (own task): de-dup the webhook insert by normalized URL or
     `(title, company, location)` within a recent window + a one-off cleanup. Deferred — care not to drop
     legitimately distinct postings.
5. **DB-access etiquette:** the user granted standing DB access this session (psql + push when sensible; ask only
   for *big* changes). Password lives in gitignored `.claude/settings.json` — never echo or commit it. Résumé/PII
   must not enter committed files.

## Migrations applied to the live DB
0011–0018 (see DAY-5) · **`0019_resume_applications.sql` applied 2026-06-22** (this session). None pending.
