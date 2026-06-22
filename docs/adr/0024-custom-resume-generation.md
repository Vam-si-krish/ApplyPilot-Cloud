# ADR 0024 — Custom (per-job) résumé generation + "Applications" section

**Status:** accepted · **Date:** 2026-06-22 · **Phases 1–2 implemented (2026-06-22); Phases 3–4 pending.**

> **Phases 1–2 are built & verified** (migration `0019` applied to the live DB; Applications tab; base-résumé
> editor with one-time LLM parse; **AI tailoring** — truthful per-job reframing via `lib/resumeTailor.ts` +
> `POST /api/applications/[id]/generate`, with a structural anti-fabrication merge and an in-app editor).
> A local end-to-end run (parse → add → generate, against the real DB + DeepSeek) confirmed: employers/dates
> preserved verbatim, zero invented skills, summary/bullets reframed to the job. Still pending: **Phase 3**
> (MacBook worker — Puppeteer PDF + auto-fit-to-one-page) and **Phase 4** (Cloudflare Tunnel + Netlify→worker
> wiring). Decision (2026-06-22): run the worker **on this dev laptop first**, prove the pipeline, then move
> the same worker to the always-on server laptop. See "Build phases" and `docs/devlog/DAY-6.md`.

## Goal
After shortlisting jobs, generate a **job-tailored résumé** for each, manage them in a new
**Applications** section, and apply with a polished PDF. Résumés must look great, **auto-fit to ONE page**,
and stay **ATS-readable**. Reuse open-source tooling; do not build a résumé/PDF engine from scratch.

## Locked decisions (from the user)
1. **Hosting:** keep the **front-end on Netlify** (this app). The user's **always-on MacBook runs a
   "résumé worker"** (does AI tailoring + PDF rendering) exposed via **Cloudflare Tunnel**. The Netlify app
   calls the worker. (We did NOT move the whole app to the MacBook — only the worker.)
2. **PDF engine:** **Puppeteer + HTML/CSS templates** (chosen for max control + the auto-fit requirement).
   Must **auto-shrink to one page** and be **ATS-readable**.
3. **Tailoring:** **rewrite the user's real bullet points** to match each job (keywords/requirements),
   **100% truthful — never fabricate.** Structured output.
4. **Editing:** **editable base résumé + per-job tweaks in-app** (an in-app editor, not just download).

## Architecture
```
Netlify (this Next.js app)  ──►  MacBook résumé worker (Node/Express + Puppeteer)  ──►  Supabase
  - Applications section          - AI tailoring (LLM)                                  - Postgres (DB)
  - base-résumé editor            - HTML template render + auto-fit-to-1-page           - Storage bucket
  - triggers + polls              - upload PDF, update applications row                   `resumes` (PDFs)
        └──────────── Cloudflare Tunnel (stable HTTPS, e.g. worker.vamsikrish.com) ──────────┘
```
- **Worker auth:** shared secret Bearer token (`WORKER_SECRET`), same discipline as `CRON_SECRET`.
- **Why a worker, not serverless:** Puppeteer/Chromium (~100MB + cold starts) and long LLM calls don't fit
  Netlify/Vercel function limits. The always-on MacBook runs them natively (also sidesteps the timeout/cron
  issues we hit elsewhere).

## PDF rendering — Puppeteer + auto-fit-to-one-page (the core)
Template is HTML/CSS driven by CSS variables: `--font-size`, `--line-height`, `--section-gap`, `--margin`.
Worker render steps:
1. Inject tailored résumé JSON into the chosen HTML template; load in headless Chrome.
2. Measure content height vs one printable page (US Letter or A4 minus margins).
3. If it overflows, **binary-search a scale factor** (e.g. 1.0 → 0.82) shrinking font/line-height/section
   gaps/margins together until it fits one page, with a **readable floor (~9.5pt; never below)**.
4. Re-measure; export to PDF (`printBackground: true`, single page).
5. If still overflowing at the floor (genuinely too much content) → return a "too long" flag so the UI/editor
   can trim, instead of silently spilling to page 2.
- **ATS rules:** real **selectable text** (never text-as-image), **standard fonts** (e.g. Inter/Calibri/
  Georgia/Arial, embedded), **single-column** semantic HTML, proper `<h*>` section headings (Experience,
  Skills, Education), no icons-as-text. Verify the exported PDF text is selectable/extractable.
- **Templates:** start from MIT-licensed **JSON Resume themes**; ship 2–3 polished options.

## AI tailoring (truthful, structured)
- Parse the user's résumé once into the **JSON Resume** schema → the **editable base** (source of truth).
  (User's résumé text is already in `profile.resume_text`; current résumé summary: Senior Frontend Dev,
  Boston MA, React/Next/TS/GraphQL/Node, JPMorgan/Yash/Msys, MS Business Analytics Hult.)
- Per job, LLM input = base résumé JSON + job description + **scoring-v2 signals we already store**
  (`score_breakdown.missing`, matched `score_keywords`, `score_breakdown` seniority). Output = tailored
  résumé JSON: rephrased real bullets surfacing the job's keywords, tuned summary, reordered skills,
  targeting ~one page. **Hard rule: only reframe real experience; invent nothing** (same anti-fabrication
  discipline as the scorer). Separate LLM call; does not touch SCORE_PROMPT.

## Data model (Supabase)
- **Base résumé:** `profile.base_resume jsonb` (structured JSON Resume, editable) — parsed once from
  `resume_text`. (Alt: a `base_resume` single-row table; either is fine.)
- **`applications`** table: `id uuid pk`, `job_id uuid fk→jobs`, `status text`
  (queued|generating|ready|applied|failed), `tailored_resume jsonb`, `template text`, `pdf_path text`,
  `error text`, `created_at`, `updated_at`, `applied_at`. (Optionally fold into / relate to existing
  `applied_at` on jobs.)
- **Storage:** bucket `resumes` (PDFs); app serves **signed URLs** for preview/download.

## End-to-end flow
1. Jobs page → select/shortlist → **"Add to Applications"** → inserts `applications` rows (status `queued`).
2. **Applications** tab lists them; "Generate" (or auto) → Netlify route POSTs to the worker (tunnel URL,
   Bearer `WORKER_SECRET`) with the application id.
3. Worker: tailor → render+auto-fit → upload PDF to Storage → set row `ready` + `pdf_path`.
4. App polls the row → shows status, **preview, download, edit (base + per-job tweaks), Mark applied**.

## Build phases
1. ✅ **DONE (in this repo):** migration `0019` (`profile.base_resume` jsonb + `applications` table +
   `resumes` Storage bucket), **Applications** tab (`app/(app)/applications/`), **"Add to Applications"**
   bulk action on Jobs, **base-résumé editor** (`components/BaseResumeEditor.tsx`) with a one-time LLM
   parse of `resume_text` → JSON Resume. Supporting code: `lib/resume.ts` (pure normalize/extract helpers),
   `lib/resumeParse.ts` (the parse call), `db.ts` helpers, routes `/api/base-resume`,
   `/api/base-resume/parse`, `/api/applications`, `/api/applications/[id]`, tests `lib/resume.test.ts`.
   Migration `0019` has been applied to the live DB (2026-06-22).
2. ✅ **DONE (in this repo):** **AI tailoring** — `lib/resumeTailor.ts` (`TAILOR_PROMPT`, `tailorResume`,
   and the pure `mergeTailored` that structurally enforces truthfulness: factual fields + the skill SET come
   from the base, the model may only rephrase/reorder); `POST /api/applications/[id]/generate`; the
   Applications tab's per-row Generate/Regenerate + an editable tailored-résumé panel (shared `ResumeFields`
   component). Tests: `lib/resumeTailor.test.ts`. Verified end-to-end locally against the live DB + DeepSeek.
3. **MacBook worker:** scaffold `resume-worker/` (Node/Express + Puppeteer + auto-fit renderer + 2–3
   templates + Supabase upload). Endpoints: `POST /generate` (id) , `GET /health`. **Run on the dev laptop
   first** (prove the pipeline), then deploy the same worker to the always-on server laptop. The worker can
   reuse `lib/resumeTailor.ts` so it tailors + renders in one call, or accept already-tailored JSON.
4. **Cloudflare Tunnel** + wire Netlify → worker URL; env + secrets.

## MacBook worker setup (guide the user later)
Install Node + `cloudflared`. Copy `resume-worker/`, set env (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
LLM key, `WORKER_SECRET`). Run the worker (pm2 or a launchd plist so it restarts on boot). Create a named
Cloudflare tunnel, route a subdomain (e.g. `worker.vamsikrish.com`) to `localhost:<port>`, run `cloudflared`
as a launchd service. Put the tunnel URL + `WORKER_SECRET` into the Netlify env.

## Alternatives considered
- **Whole app on the MacBook** (would also fix cron/timeouts) — user chose to keep Netlify front-end.
- **Typst** (typeset/ATS, lighter) and **react-pdf** (serverless-friendly) — rejected for the engine: harder
  to do dynamic measure-and-refit-to-one-page than Puppeteer.
- **Self-host Reactive Resume** (full builder, 20+ templates, API) — heavier; revisit if we want its templates.

## Sources
Reactive Resume (github.com/AmruthPillai/Reactive-Resume) · RenderCV (rendercv.com) · JSON Resume themes
(jsonresume.org/themes) · Puppeteer vs react-pdf production comparison (dev.to/iurii_rogulia) · Typst résumé
packages (typst.app/universe) · Cloudflare Tunnel guide (dev.to/recca0120).
