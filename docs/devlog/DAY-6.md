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

---

## 2026-06-23 — Fixed: Generate 502'd on Netlify (tailoring moved to the worker, ADR 0027)
**Symptom:** `POST /api/applications/[id]/generate` returned **502 Bad Gateway** (Netlify, `text/plain`).
**Root cause:** the route ran the tailoring LLM call inline (~4000 tokens, 30–90s). Netlify hard-caps
synchronous functions at ~26s; `export const maxDuration = 60` is a *Vercel* setting Netlify ignores. So
the platform killed the function mid-call → 502 (not our JSON error path). Started failing once a real vault
key made the call actually run. No synchronous approach fits.
**Fix (ADR 0027):** offloaded tailoring to the always-on `resume-worker` (no serverless timeout), same path
`/render` already uses.
- `resume-worker/tailor.js` — hand-kept port of `lib/resumeTailor.ts` + `lib/llm.ts` + `lib/resume.ts`
  (**keep in sync by hand**; ADR 0026 rules + `mergeTailored` anchoring unchanged).
- `resume-worker/supabase.js` — added `getApplicationWithJob`, `getSettings`, `getBaseResume`,
  `getActiveApiKey` (vault key is plaintext in `api_keys`, env fallback).
- `resume-worker/server.js` — new `POST /tailor {id}`: validates preconditions sync (fast 4xx), marks
  `generating`, **acks 202**, runs the LLM call in the background, writes `tailored_resume` + `tailor_changes`
  + `ready`/`failed`.
- `app/api/applications/[id]/generate/route.ts` — now a thin proxy to `/tailor`, returns 202 immediately.
- `app/(app)/applications/page.tsx` — `generate()` polls the row (2.5s, ~3 min cap) instead of awaiting.
- typecheck ✅ · 95 tests ✅ · worker `node --check` ✅.
**Carryover:** generation now needs the worker online (PDF already did). Worker needs
`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` in its `.env` (it already does for PDF). Undeployed like the rest.

### Follow-up — Worker URL/secret configurable from the UI (Settings → Résumé Worker)
- **Migration `0022_resume_worker_secret.sql` — APPLIED to live DB & verified** (2026-06-23): adds
  `settings.resume_worker_secret TEXT`. (`resume_worker_url` already existed via `0020_resume_worker_url.sql`.)
- **Secret is write-only to the browser:** settings GET returns a **masked** preview (`maskKey`), never the raw
  value; PUT ignores any value containing `•` (the echoed mask) and treats blank as "leave unchanged" — so
  saving other settings never wipes the secret.
- **Precedence fixed (was an env-override footgun):** all three worker routes now resolve
  `settings?.resume_worker_url?.trim() || process.env.RESUME_WORKER_URL` (and same for the secret) — the
  **UI value wins**, env is the fallback. Previously env silently overrode the UI value.
- UI: Settings → Résumé Worker now has a password-type "Worker secret" field with saved-status helper text;
  must match the worker's `WORKER_SECRET`. typecheck ✅ · 95 tests ✅ · build ✅.
- **Still undeployed** — goes live on push → Netlify. Migration is already applied, so deploy is safe (column exists).

---

## 2026-06-23 — Fit scoring: single-flight lock + progress bar + Stop (ADR 0028)
**Reviewed the whole scoring pipeline** (`/api/run` → apify-webhook → score-batch self-loop → assess).
Two findings + fixes:
- **Duplicate scoring (real bug):** `getUnscoredBatch` had no claim — rows stayed `unscored` across the LLM
  call, so concurrent chains (one webhook per portal, the manual button, overlapping runs) scored the same
  jobs 2–3× (idempotent write hid it). **Fixed** with a single-flight mutex.
- **The "continuous call" the user saw** = `GET /api/stats` every 10s from `AppShell` (every page) + dashboard.
  Harmless polling, not the scorer; gave no real progress/stopped signal.
- **`scoring_state` table (migration 0023 — APPLIED to live DB & verified)**: singleton row, atomic CAS
  acquire (`UPDATE … WHERE active=false OR heartbeat<now()-120s`) = exactly one chain; token-scoped
  continuation; `stop_requested`; `total`/`done` progress; `rescan_requested` to avoid orphaning late-arriving
  rows.
- **score-batch rewritten**: `?token` distinguishes START (acquire lock, no-op if busy) vs CONTINUE (drive
  owning session). `triggerScoreBatch(token?)` carries it. New `/api/score-status` + `/api/score-stop`.
- **UI**: `components/ScoringPanel.tsx` (mirrors the Gmail SyncProgressPanel) on **Dashboard + Jobs** — live
  `done/total` bar, Stop (halts after current batch, scored work kept), Start when jobs wait, "Done" flash.
  Polls 2.5s active / 12s idle. Replaced the old "Score unscored" button on Jobs.
- typecheck ✅ · 95 tests ✅ · build ✅. **Undeployed** — goes live on push (migration already applied → safe).

---

## 2026-06-23 — UX pass: user-driven scoring, visible progress, 1-page tailoring, 3 scores (ADR 0029)
Five changes from user feedback:
1. **Removed the auto "Score now" button** (Dashboard + Jobs). `ScoringPanel` now only *surfaces* an
   already-running automatic pass (daily run/webhook) + Stop. Scoring is user-driven via job selection.
2. **Prominent progress for selection scoring** — new `components/ProgressToast.tsx` (fixed bottom-right,
   done/total bar) replaces the tiny inline "5/25" text; list refreshes live per chunk.
3. **Same for company assessment** (Assess/re-assess) — same toast (violet tone).
4. **Length-neutral tailoring** — `TAILOR_PROMPT` (lib + worker) now forbids increasing bullet count
   ("add one, remove one"; skills still allowed); `mergeTailored` caps each role/project's highlights to
   the base count (`capHighlights`). Stops 1-page résumés spilling to page 2.
5. **3 scores in Applications** — migration **0024 (APPLIED to live DB & verified)**:
   `applications.tailored_fit_score` + `tailored_score_note`. New `POST /api/applications/[id]/score-tailored`
   (one scorer call over `resumeToText(tailored)`), auto-run after generation; row shows Job fit + company
   tier + Résumé X/10 (with delta). Regenerate clears the stale score (worker writes null) → re-scores;
   older rows get a one-click "Score résumé".
- typecheck ✅ · 95 tests ✅ · build ✅ · worker `node --check` ✅. **Undeployed** — push to go live
  (migrations 0023+0024 already applied → safe).

---

## 2026-06-23 — Tailor & Apply UX + clearance gate (ADR 0030)
1. **"Did you apply?" on the Applications tab** — same pendingApply ref + visibilitychange dialog as Jobs;
   "Yes" marks the application applied (stamps applied_at).
2. **Renamed "Applications" → "Tailor & Apply"** (nav + heading; route stays /applications). Per user.
3. **Proper PDF filenames** — `/api/applications/[id]/pdf` now builds "<Name> - <Company> - Resume.pdf"
   from the tailored résumé + job company and sets it via the signed-URL `download` option; client downloads
   via an `<a download>` click (direct download, no blank preview tab).
4. **Clearance/citizenship gate strengthened** — the scorer already scored 1 for clearance/US-citizen/Green-Card
   (scoring.ts Phase 1); made it a prominent HARD BLOCK with synonyms (USC, TS/SCI, Public Trust, Q clearance,
   ITAR US-Persons-only…). Score 1, skill fit irrelevant. New eval `clearance-required.json` locks it.
- No migrations (code + prompt only). typecheck ✅ · 96 tests ✅ · build ✅. **Undeployed** — push to go live.
- Note: the fit scorer scores the BASE résumé; it already suits the fetch→score→top100→assess→tailor funnel.
  The only requested rubric change (clearance) was already present and is now hardened.

---

## 2026-06-23 — Strict one-page tailoring + token/cache cuts (ADR 0031)
Root cause of the second-page spill: `capHighlights` capped bullet **count**, not **size**,
and summary/skills were uncapped — while the prompt invited bullets to grow "in depth." The
font auto-shrink bottomed out at the ~9pt floor and then spilled to page 2 (`tooLong`). Fix
across both hand-synced copies (`lib/*` + `resume-worker/*`):
1. **Deterministic caps in `mergeTailored`** (always): summary length `max(baseLen×1.15, 320)`
   chars, total skill keywords `max(baseCount+6, ceil(baseCount×1.4))`, plus the existing
   bullet-count cap.
2. **AI-condense loop + hard backstop** on the worker (`renderResumeToOnePage`): render → if it
   would overflow the readable floor, the model condenses (≤2 passes, it picks what to cut) →
   re-render; then a deterministic backstop drops the least-important bullet until it fits —
   **can never ship 2 pages**. A shortened résumé is persisted back to `tailored_resume` (PDF ↔
   screen match) and its stale tailored fit score is cleared.
3. **Patch-shaped output** — `TAILOR_PROMPT` now emits ONLY the fields the merge keeps
   (summary/label, per-role/project highlights + a `name` alignment key, skills, `_changes`),
   omitting identity/contact/titles/dates/locations/education (restored from base anyway).
   Prompt-only change — `normalizeResume`/`mergeTailored` already ignore the omitted fields.
   ~½ the output tokens, less drift.
4. **Prompt caching** — `ChatMessage.content` may be `string | ContentPart[]`; Anthropic client
   attaches `cache_control` to `cache:true` parts (other providers concatenate, unchanged).
   `buildTailorMessages` caches the system prompt + base résumé + length budget; only the
   per-job tail is uncached. Sonnet 4.6 caches a ≥2048-tok prefix; sparse résumés silently
   skip caching (no error). Default 5-min TTL (no extended-TTL header dependency).
- No migrations. typecheck ✅ · 99 tests ✅ (+3) · build ✅ · worker `node --check` ✅.
  **Undeployed — worker redeploy required** (condense loop + renderResumeToOnePage live there).

---

## 2026-06-23 — Clickable résumé links + codebase review backlog
1. **Clickable contact links in the PDF** — `resume-worker/templates.js` rendered LinkedIn/GitHub/
   website/phone/email as plain text; now real `<a>` anchors (tel:/mailto:/https, bare handles get a
   scheme), styled to read as plain text. Project URL linked too. Verified via `node render-sample.js`
   (`/URI` annotations present, still one page). **Worker redeploy required.**
2. **Full-codebase review → [docs/BACKLOG.md](../BACKLOG.md)** — a do-one-by-one checklist (security
   password rotation, URL-dedup bug fix, scoring/assistant prompt-caching, `/api/jobs` over-fetch,
   render the tailored label, nav/UX). **Next session: start from BACKLOG.md and work top-down.**

---

## 2026-06-23 — Generate 502 fixed permanently (ADR 0032)
Root cause: the worker's Cloudflare **quick tunnel** mints a new random URL each restart, and the
app's `settings.resume_worker_url` was hand-set → every tunnel restart broke Generate with a 502.
(The named-tunnel `worker.vamsikrish.com` path is blocked — the domain's DNS is on Netlify/NS1, not
Cloudflare, so the route's CNAME lands in an inactive CF zone with no edge TLS.)
Fix: `resume-worker/tunnel.mjs` owns the quick tunnel and **auto-publishes its current URL into
`settings.resume_worker_url`** (Supabase REST, worker `.env` creds; app prefers DB over env → no
redeploy). Both worker + tunnel now run as launchd LaunchAgents (RunAtLoad+KeepAlive) via
`install-service.sh` / `install-tunnel-service.sh`. Verified end-to-end: app→tunnel→worker `/health`
200, `/tailor` 401. Restarting the worker under launchd also activated the uncommitted ADR 0031
one-page changes + clickable-links template. Quick tunnels still need the Mac awake + logged in.

---

## 2026-06-23 — Fuller bullets + human voice (ADR 0033)
The one-page résumé looked weak: bullets forced to one ~120-char line → half-empty page with
thin points, plus AI tells (em-dashes, buzzwords). Since the one-page guarantee now lives in the
renderer (ADR 0031), the prompt no longer needs to crush bullets. Tuned both synced copies
(`lib/resumeTailor.ts` + `resume-worker/tailor.js`): (1) `LENGTH` now asks for SUBSTANTIAL ~2-line
bullets (~180-210 chars: scope + action + tech + metric) that fill the page, same count; (2) added
a "WRITE LIKE A HUMAN" section — varied action verbs, quantified, **no em-dashes**, banned-words
list; (3) deterministic `cleanText` strips em-dashes (U+2014→comma) from every bullet + summary in
`mergeTailored` (hyphens/en-dashes untouched); (4) softened the condense prompt to trim *just enough*
instead of crushing to one line. typecheck ✅ · 100 tests ✅ (+1 em-dash regression) · build ✅ ·
worker `node --check` ✅. **Live** — worker service kickstarted to load it.
