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

## ▶ NEXT: continue ADR 0024
- **Phase 3 — MacBook worker** (`resume-worker/`, Node/Express + Puppeteer): HTML/CSS templates +
  auto-fit-to-one-page (binary-search font/line-height/margins, ~9.5pt floor) + ATS-readable + upload PDF to
  the `resumes` bucket + set the row `ready`/`pdf_path`. `POST /generate` (id), `GET /health`, Bearer `WORKER_SECRET`.
- **Phase 4 — Cloudflare Tunnel**: expose the worker (e.g. `worker.vamsikrish.com`); Netlify route POSTs to it;
  app polls the application row; preview/download via signed URL.

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
4. **BUG (unresolved):** ">24h jobs appear on the main page when no filter is selected." Code verified correct
   (`buildParams` always sends `recency=recent`; API filters `discovered_at >= now()-24h`). Almost certainly a
   **data** cause (same posting re-inserted as a new row — de-dup is by exact `url`). Needs a read-only DB
   diagnostic (user must approve), then likely tighten de-dup.
5. **DB-access etiquette:** explicit user approval before ANY Supabase access. Migrations applied manually via
   psql (password in gitignored `.claude/settings.json` — never echo or commit it). Résumé/PII must not enter
   committed files.

## Migrations applied to the live DB
0011–0018 (see DAY-5) · **`0019_resume_applications.sql` applied 2026-06-22** (this session). None pending.
