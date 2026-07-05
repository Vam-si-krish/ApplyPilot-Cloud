# Devlog — Day 8 (2026-07-02) · START HERE for the new session

## ✅ Shipped this session: ATS-style match score v2 (ADR 0053)
The user's ask: the computed (non-AI) match % was useless as a first filter over a 200–400-job
fetch — research how ATS software compares résumé↔JD and make it a score worth filtering on.
**Explicit constraint: the AI fit scoring (`lib/scoring.ts`, SCORE_PROMPT, scoreRunner LLM path)
is untouched.** The new score is layer 1; AI stays the judgment.

### What landed
- **`lib/prefilter.ts` rewritten** (v1 IDF primitives kept as one component):
  55% skills (curated alias lexicon + Settings→Skills; required ×1.6 / nice-to-have ×0.6 /
  in-title ×1.5 / frequency boost) + 15% title alignment + 30% IDF keyword coverage,
  − penalties (years gap ≤ −15, required advanced degree −8), clearance/citizenship → capped at 5.
  HTML stripped before tokenizing (v1 scored raw HTML — a big source of its noise).
- **Migration 0033** (applied to live DB): `jobs.prefilter_breakdown jsonb` — component scores,
  matched/missing skills, penalty flags.
- **Webhook** stores score + breakdown at ingestion; **`POST /api/jobs/recompute-match`** re-scores
  all non-archived jobs (pure CPU, no LLM) after résumé/skills changes.
- **UI:** gauge "ATS NN%" badge on Jobs rows (MatchBadge); Sort: AI fit / ATS match; ATS-match
  filter in More filters (incl. "Weak match < 40%" for the delete pass); "Recompute ATS match"
  header button; JobDetails shows the full breakdown; JobsLegend + Settings copy updated.
- **Tests:** `lib/prefilter.test.ts` rewritten (22 tests). `npm run typecheck` + full suite green.

### Live validation (all 2,024 jobs re-scored via local script)
Distribution: 110 ≥65 · 747 at 40–64 · 1,083 at 20–39 · 84 <20. Vs existing AI fit scores: avg ATS
monotone in fit (fit 1 → 19.6, fit 10 → 78), corr ≈ 0.54. Threshold simulation: cutting <35% removes
~73% of fit≤5 jobs, loses ~16% of fit≥8; <25% loses only ~11%. Top scores = React/JS/Next.js roles;
bottom = clearance-restricted (capped 5) and off-stack (Java) roles. Looks right.

### Research trail (for future tuning)
Jobscan match-rate docs (hard skills ≫ title > education > other keywords; frequency matters);
ats-screener (MIT, TS — taxonomy + synonyms + required/preferred sections + per-ATS weights);
srbhr/Resume-Matcher (simpler than our v1); embeddings rejected again (spread/explainability).

## ✅ Also shipped: tailored-résumé ATS check (ADR 0053 addendum)
Asked-for follow-up: after tailoring in Tailor & Apply, re-check the ATS match with the NEW résumé.
This is the local scorer, not the dropped LLM re-score (ADR 0050 stays in force):
- Migration 0034 (applied live): `applications.tailored_match_score` + `tailored_match_breakdown`.
- `POST /api/applications/ats-check` — tailored + base scored against the same job in one call
  (single-job mode drops the batch-IDF keywords component on both sides so the pair is comparable;
  `AtsMatchBreakdown.keywords` is now nullable below 5-job batches).
- UI: auto-runs after generation; gauge button per row shows tailored % (click to re-check after
  edits); toast reports "base% → tailored% · still missing: …".
- Tests 131 green, typecheck + build green.

## ✅ Also shipped: tailoring prompt v3 (ADR 0054) — shortlist-signal upgrades
Research pass over the three AI lanes (scoring / tailoring / company check) → user picked the
tailoring improvements to implement now (kept the "~15-day learnable skills" policy deliberately):
- **TITLE ALIGNMENT** — `basics.label` becomes an honest variant of the target job title (title
  match ≈ 3.5× callbacks); seniority stays bounded by the dates.
- **MIRROR EXACT WORDING** — skills/phrases written exactly as the posting writes them (literal ATS).
- **SUMMARY top-third rules** — first line answers the posting; lead with 2-3 role-matching
  quantified facts.
- **Varied bullet lengths** — strongest bullet first at ~2 lines, rest 1-2 lines; kills the
  templated uniform look.
- **ATS feed-forward** — `signals.atsMissing` (exact terms from `prefilter_breakdown.missing`) into
  the tailor prompt; manual paste-a-JD route computes it on the fly. With the post-generate ATS
  check, the loop is closed (missing terms in → gauge verifies after).
- Both prompt copies updated in sync (`lib/resumeTailor.ts` + `resume-worker/tailor.js`); worker
  `tailorSignals()` now shared by `/tailor`. Tests 133 green; typecheck + build green.
- ⚠ **Worker Mac must `git pull` + restart** to serve the new prompt (stale-deploy gotcha).

Scoring/company-check improvements from the same research (reasoning-before-score reorder, mapping
table, model upgrade, outcome calibration, repost signals) are documented in the Day-8 assessment
but NOT implemented — scoring changes need eval expansion first (CLAUDE.md discipline).

## ✅ Also shipped: bulk ATS actions + before→after display + delete-résumé fix
- **Jobs tab:** "ATS score (N)" in the selection toolbar → recompute-match for just those ids;
  the route pads selections < 30 with a 50-job recent corpus so batch-IDF keywords stay comparable.
- **Tailor & Apply:** "ATS check selected" bulk button (parallel ×4); the row gauge now shows
  "base% → tailored%" permanently (`applications.base_match_score`, migration 0035, applied live).
- **Bug fix:** clear-scores 'tailored' left rows stuck on 'ready' with no résumé — now resets
  ready/generating/failed rows to 'queued' and clears pdf_path + tailor/ATS artifacts ('applied'
  rows keep status). Live DB checked: no stuck rows needed repair.

## ✅ Also shipped: tailorable job titles (ADR 0055)
User request: tailoring never touched role titles (hard-anchored since ADR 0026). Now:
- `mergeTailored` accepts the model's `work[i].position` (discipline reframe, never level —
  prompt-enforced; empty keeps base). Employers/dates/education stay hard-anchored.
- Deterministic disclosure: `titleChanges()` → `TailorChanges.titleChanges` ("Company: old → new"),
  shown as "Job titles adjusted" in ChangesReview + the download confirm; ResumeDiff already
  diffs `position`, so before/after shows it with no changes needed.
- Both prompt copies updated (JOB TITLES section; `position` in the output schema).
  Tests 134 green; typecheck + build green. ⚠ Worker Mac `git pull` + restart required.

## ✅ Also shipped: prompt-caching audit + scoring token cuts (ADR 0056)
Audited every LLM call path for caching correctness and token waste:
- **Tailoring** — already correct (cached base-block prefix, ADR 0031; verified in both copies;
  `chatAnthropic` maps `cache:true` → `cache_control` and the breakpoint covers system as prefix).
- **Scoring (the fix)** — was scoring RAW HTML (tags ≈ 20-40% of job tokens, and the 15000-char cut
  ate real content) with zero cache breakpoints. Now: `stripHtml` before truncation + the résumé
  segment is a cache breakpoint (`[{résumé, cache:true}, {job}]`) in `lib/scoring.ts` AND the worker
  port `resume-worker/scoring.js`. Non-Anthropic providers flatten back to the byte-identical old
  string (implicit prefix caching preserved); Agent-SDK path flattens too (verified agentClient.js).
- **scoreJobRows warm-first** — first row scored alone to write the cache, then the ×8 pool reads it
  (parallel first-wave all missed before).
- **Left alone deliberately**: company check + mail classify (prompts below the 1024–4096-token
  minimum cacheable prefix), assistant (low-volume interactive), cover letter (low volume).
- SCORE_PROMPT/rubric/parsing untouched; scoring tests extended (HTML strip, breakpoint placement,
  flatten parity); 136 tests + typecheck + build green. CLAUDE.md scoring line updated.
- ⚠ Worker Mac `git pull` + restart to pick up the scoring-port change.

## 🔎 Diagnosed: "titles not changing" after the ADR 0055 deploy
User generated a résumé post-deploy; role titles unchanged. Root cause: **stale Worker Mac** —
`GET <worker>/version` returned commit `f2c5d58` (ADR 0054, headline alignment — which is why the
headline diff worked) but tailorable titles are `a9b2a25`, one commit later. The worker's old
prompt still hard-blocks titles and its old merge restores base positions. **Fix: Worker Mac
`git pull` + restart** (ADR 0032's self-update covers the tunnel URL only, not code).
- Render path verified end-to-end: worker `/render` → `appRow.tailored_resume` → `renderHtml` →
  `workEntry` prints `w.position` per role. The PDF header deliberately shows name + contact only
  (NO headline) — user explicitly wants the template unchanged; `basics.label` tailoring stays
  (feeds the ATS title component + diff view) but is not printed.
- **Prompt sharpened (both copies)**: JOB TITLES is now "ALIGN with the target title whenever the
  work honestly supports it (most recent role matters most)" instead of "you MAY adjust" — leaving
  a title unchanged is the exception, level inflation still forbidden.

## ✅ Also shipped: duplicate-posting dedup (ADR 0057)
User showed 12 identical Deloitte rows (one req blasted per metro). Measured: ~32% of the DB were
copies; 561 LLM calls wasted; reposts re-arrive daily under fresh URLs so it compounds.
- `lib/dedupe.ts` `jobContentKey` (md5 of company+title+normalized body; location excluded);
  migration 0036 (`content_key`, `duplicate_of`, indexes) applied live.
- Webhook links duplicates after insert (`linkDuplicateJobs`); an unscored duplicate whose
  canonical is scored inherits the score verbatim (copy of a real score for identical content —
  rubric doesn't score location). Scoring loop does the same; canonicals ordered first.
- Jobs API hides duplicate rows (interacted ones stay), attaches `siblings`; UI shows a "+N"
  location chip and the expanded panel lists each location as an openable link.
- Backfill run: 2,367 rows keyed, 668 duplicates linked, 646 with scores; Deloitte cluster from
  the screenshot is now 1 row + 11 variants. Tests 140 green; typecheck + build green.
- No worker deploy needed for this one (all app-side).

## ✅ Also shipped: dedup v2 — aggressive keys + ranked canonicals (ADR 0057 addendum)
User: strict body-hash missed real blasts (bodies vary per city) and the "+N" chip wasn't
clickable. Changes:
- Key = company+title (normalized; body only as fallback) — user-directed aggressive mode.
- `pickCanonical`: Remote > Settings location > scored > earliest; existing groups never
  re-parent (zero chains verified). Deloitte canonical is now Boston, MA.
- Chip is a button (expands the row → location links, Remote-first sort), turns green ✓ when ANY
  variant was applied — the don't-apply-twice guard.
- Re-backfill: 763 linked / 1,604 canonicals. Tests 145 green; typecheck + build green.

## Open questions / follow-ups
- **Not deployed yet** — Netlify deploy + the daily fetch will use the new scorer automatically.
  The existing rows are already re-scored directly in the DB.
- Settings `prefilter_threshold` default is still 30 from ADR 0008; with the new metric 30–35 is
  a sensible gate. User should eyeball a few 30–45% jobs before turning the auto-filter on.
- Lexicon is software/data-centric; extend `SKILL_GROUPS` (or just Settings→Skills, which
  auto-registers) if fetches broaden.
- The user filters with "Weak match < 40%" + select-all + Delete selected as the manual first pass.

## ✅ LinkedIn query refinement + spend guards (ADR 0058)
Research request → implementation. Findings that shaped it: the vault rotates 6 free Apify
accounts ($30/mo pool); the ACTIVE key was maxed ($5/$5) so fetching was silently dead; Jun 20/21
had same-day duplicate runs re-billing the window; the user applies NATIONWIDE (127 applies
outside saved metros) so locations were left alone; "Remote, US" was an ungeocodable search.
- One boolean `"kw1" OR "kw2"…` search per location (30 → 6 searches); remote-ish locations →
  `United States + f_WT=2`; `f_E` from new `linkedin_experience_levels` (live: 2,3,4) and
  `f_JT=F,C` baked into URLs — all filter BEFORE per-result billing.
- `/api/run`: 12h cooldown (confirm-and-force in UI) + `ensureApifyKeyWithCredit` (skips maxed
  keys via the Apify limits API, 402 when all dry). Activated the fresh `1 vamsichiguruwada1` key.
- career_sites portal (fantastic.jobs) fully wired but OFF: real price is **$12/1k on free tier**
  (user: too high; screenshot + pricingInfos API both confirm; "$4/1k" is the GOLD-plan price).
  Opt-in checkbox shows the price; `career_sites_max_jobs` (150) is the spend dial.
- Migration 0037 applied live. Tests 154 green; typecheck + build green. No worker deploy needed.

### Follow-ups
- Watch the first boolean-query run: confirm cheap_scraper passes quoted/OR keywords through
  (fallback = revert to per-role startUrls).
- Cron still external (Netlify/worker-Mac launchd); auto_scrape_enabled is false — runs are manual.

## ✅ Applied everywhere + key credit cooldown (ADR 0059)
- Jobs tab now has a per-row Mark-applied toggle (the popup was the only way); Tailor & Apply's
  applied badge toggles too. Both PATCH routes sync the OTHER table (jobs.applied_at feeds
  stats + the ADR-0057 apply-once guard, applications.status drives T&A) — they can no longer
  disagree.
- Apify keys that can't afford a FULL fetch are parked (`api_keys.cooldown_until` = that
  account's cycle reset from the limits API); rotation + the pre-run probe skip parked keys, so
  a run never dies mid-scrape on a dry account. Threshold = estimateRunCostUsd(settings):
  caps × free-tier price × 1.3, floor $0.75 (user's 800-cap LinkedIn run ≈ $0.73 worst case).
  Settings → API Keys shows "⏸ low credit · resets <date>". Migration 0038 applied live.
- Tests 158 green; typecheck + build green. App-side only.

## ✅ UI redesign v2 — "aurora console" (all tabs)
User asked for a tab-by-tab reimagining: "make the UI look beautiful… as stunning as possible
in every page," without breaking features. Approach: keep every Tailwind token NAME from the
Lite port (`void/card/raised/ink/sky/slate-*`) so all ~7.8k lines of pages kept compiling, but
refresh the VALUES and layer a design system on top. Zero logic/handler changes.
- Foundation: Space Grotesk / Inter / JetBrains Mono (was Syne/Outfit/Fira Code); richer
  blue-violet surfaces + new `iris` (#8b93ff) secondary accent for sky→iris gradients; brighter
  `slate-muted` (#8e97b8) for readability; fixed-position ambient "aurora" glows on `body::before`;
  layered `shadow-card`/`shadow-pop`; reusable classes in globals.css (`.card .btn-primary
  .btn-ghost .btn-danger .input .label .chip .page-title .page-sub .text-gradient`).
- AppShell: nav grouped (Pipeline / Follow-up / Setup) with gradient active-indicator bars; the
  raw stats list became a Pipeline mini-card with a scored/total progress bar.
- Pages: login (centered hero + aurora), dashboard (accent stat cards — runtime `text-${color}`
  replaced with a static ACCENTS map so Tailwind actually sees the classes; status-pill Last run;
  gradient distribution bars), jobs + past (segmented status tabs, highlighted selection toolbar,
  skeleton loading rows, icon-buttons with hover tints, JobDetails as an inset panel), T&A
  (gradient tab underline, same row/panel treatment), inbox/tracker/assistant/profile/settings
  (Section headers with gradient ticks + sticky Save bar on settings; chat bubbles with
  asymmetric corners on assistant).
- Verified: typecheck, 158 tests, production build all green; puppeteer (via resume-worker's
  copy) screenshotted every tab live — all render correctly. Jobs showed its (styled) empty
  state because /api/jobs hit a slow-query 500 + the default filter view genuinely matched 0
  rows mid-fetch; row rendering proven on Past Jobs (1,471 rows, same components).

### Follow-ups
- /api/jobs 500'd twice at ~8-9s on this machine (Supabase slow query) — pre-existing, worth a
  look (indexes or query shape), unrelated to the redesign.

## ✅ Fixed: auto-download dropped one PDF (résumé OR cover letter) — ADR 0062
User: auto-download-on-open was inconsistent — sometimes only résumé, sometimes only cover
letter, sometimes both. Cause: the PDF routes return Supabase Storage SIGNED URLs (cross-origin);
browsers ignore `<a download>` on cross-origin hrefs and treat the click as a top-level
navigation, so firing both downloads at once made them race and cancel each other. Fix:
`triggerDownload()` fetches the bytes into a same-origin blob URL (blob downloads don't navigate,
so N run concurrently and the filename is honoured; falls back to direct nav on error), and the
open handler now awaits the résumé before the cover letter. Both download fns → Promise<boolean>;
all call sites (incl. the bulk cover-letter flow) benefit. Typecheck + build + 158 tests green.
Client-only — no API/worker/DB change.
