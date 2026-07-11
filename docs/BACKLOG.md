# Backlog — codebase review (opened 2026-06-23)

A living, do-it-one-by-one checklist from a full-codebase review (token efficiency,
performance, correctness, UX). Work top-to-bottom unless priorities change.

## How to work this list
1. Pick the top unchecked item. Read its **Fix** and **Files**.
2. Make the change. Verify with the gates that apply:
   - App/TS: `npm run typecheck` · `npm run test` · `npm run build`
   - Worker (`resume-worker/*`): `node --check <file>` (+ `node render-sample.js` for render/template changes)
3. Tick the box here, and append a one-line note to the latest `docs/devlog/DAY-*.md`.
4. Commit (conventional commit, *why* in the body). Branch off `main` first.

## ⚠ Current repo state (read before starting)
- The working tree has **uncommitted** changes: ADR 0030 (apply UX), ADR 0031 (one-page
  tailoring + caching + patch output), and the contact-links fix (`resume-worker/templates.js`).
  Decide whether to commit those first.
- **Deploy gap:** app changes go live only on push → Netlify build. Worker changes
  (links fix + ADR 0031 condense loop) need the **always-on worker to be restarted**.

---

## P0 — Security (do first; user action, not code)
- [ ] **A. Rotate the Supabase DB password and the account password.**
  - Why: `.claude/settings.json` (DB password, also reused as the signup password) was
    committed to the **public** repo's history (DAY-5). Gitignoring it does not remove it
    from history — the secret is still recoverable.
  - Fix: Supabase → Project Settings → Database → reset password; update local
    `.claude/settings.json` (gitignored) and any Netlify env. Change the account password.
  - Verify: old password no longer authenticates; app + migrations still work with the new one.

## P1 — Correctness bug (user-visible)
- [ ] **B. Canonicalize job URLs before dedup (fixes ">24h jobs reappear").**
  - Why: dedup is `onConflict: 'url'` ([apify-webhook/route.ts:86](app/api/apify-webhook/route.ts#L86))
    and `jobs.url` is `unique`, but LinkedIn appends varying tracking params
    (`?refId=…&trackingId=…`). The same posting re-inserts as a NEW row with a fresh
    `discovered_at`, so it shows again in the last-24h view.
  - Fix: strip the query string + fragment (and trailing slash) from the URL in
    `mapDatasetItemToJob` before upsert so the canonical URL dedups. Optionally add a
    secondary guard on normalized `(title, company)`.
  - Verify: re-running a fetch over the same postings does not create duplicate rows;
    the main view stops showing >24h-old jobs. (A read-only DB count by `(title,company)`
    confirms — needs user approval per the DB-access etiquette in DAY-5.)

## P2 — High-value token / performance (cheap)
- [ ] **C. Prompt-cache the scoring résumé + rubric prefix.**
  - Why: `buildScoreMessages` ([scoring.ts:132](lib/scoring.ts#L132)) puts the stable
    résumé + `SCORE_PROMPT` first and the per-job posting second, but sends **no
    `cache_control`**. Across a batch of hundreds of jobs the prefix is re-billed every
    call on Anthropic. The caching primitive now exists (ADR 0031: `ContentPart`/`cache`).
  - Fix: split the user message into `[{ text: résumé block, cache: true }, { text: job }]`
    (same pattern as `buildTailorMessages`). Harmless on OpenAI/Gemini (they concatenate;
    OpenAI also auto-caches stable prefixes ≥1024 tok). Note: scoring default is
    gpt-4o-mini, so the clear win is when scoring runs on Anthropic.
  - Verify: typecheck + tests; on an Anthropic scoring run, `usage.cache_read_input_tokens`
    is non-zero from the 2nd job onward.
- [ ] **D. Stop `/api/jobs` from over-fetching `full_description` / `score_reasoning`.**
  - Why: the list query is `select('*')` for up to 200 rows
    ([jobs/route.ts:30](app/api/jobs/route.ts#L30)), shipping multi-KB `full_description`
    + `score_reasoning` the list never shows until a row is expanded → multi-MB payloads
    on every Jobs/Past load.
  - Fix: select only the columns the list/badges need; fetch the heavy detail fields
    lazily on row-expand (extend an existing detail fetch, or a `?id=` detail endpoint).
    Keep `idsOnly` path as-is.
  - Verify: Jobs page network payload drops sharply; expanding a row still shows the full
    description + reasoning.

## P3 — Smaller wins
- [ ] **E. Render the tailored job title (`basics.label`) on the PDF.**
  - Why: tailoring computes/stores `basics.label`, and the `.label` CSS exists in
    [templates.js](resume-worker/templates.js), but the header only draws `.name` +
    `.contact` — the headline (e.g. "Senior Frontend Engineer") never appears.
  - Fix: add `<div class="label">${esc(b.label||'')}</div>` to the header (between name
    and contact) when `b.label` is present. Worker change → re-render sample + redeploy.
  - Verify: `node render-sample.js` shows the label; still one page.
- [ ] **F. Prompt-cache the assistant system prompt (full profile JSON each turn).**
  - Why: `buildAssistantSystem` ([assistant.ts:88](lib/assistant.ts#L88)) embeds the whole
    profile JSON in the system prompt every turn — stable across the conversation.
  - Fix: mark the system block cacheable (once the assistant route uses the array-content
    path). Medium value; lower priority than C.
  - Verify: typecheck + tests; cache reads non-zero on multi-turn Anthropic chats.

## P4 — UX / maintainability (subjective; confirm with user before doing)
- [ ] **G. Reduce nav from 9 items to a clearer funnel.**
  - Why: [AppShell.tsx:11](components/AppShell.tsx#L11) lists Dashboard, Jobs, Tailor &
    Apply, Past Jobs, Inbox, Tracker, Assistant, Profile, Settings. The core path is
    Jobs → Tailor & Apply; the rest are secondary.
  - Fix (proposal): group secondary items (e.g. Inbox + Tracker under one "Activity" area;
    fold Profile into Settings). Get user sign-off on grouping before implementing.
- [ ] **H. Split the monolithic pages.**
  - Why: [settings/page.tsx](app/(app)/settings/page.tsx) ≈ 1,165 lines,
    [jobs/page.tsx](app/(app)/jobs/page.tsx) ≈ 1,034 lines — hard to evolve.
  - Fix: extract per-section components (Settings especially). Not user-facing; do when
    touching those pages anyway.

---

## Done
- [x] **Clickable contact links in the résumé PDF** (2026-06-23). `resume-worker/templates.js`:
  phone → `tel:`, email → `mailto:`, LinkedIn/GitHub/website → `https://` (bare handles get a
  scheme), project URL linked; anchors styled to read as plain text. Verified via
  `node render-sample.js` (PDF carries `/URI` annotations, still one page). **Needs worker redeploy.**
