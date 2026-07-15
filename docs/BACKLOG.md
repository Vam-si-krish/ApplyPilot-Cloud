# Backlog — codebase review (opened 2026-06-23)

## `multi-user-fork` roadmap (current user priority; ADR 0072)

- [x] **Phase 1: provision the isolated server backend.** Clone the branch into
  `~/apps/jobpilot-multi`, run `backend/scripts/bootstrap.sh`, and pass the fresh-DB,
  local/public health, REST, storage, worker, recovery, and backup gates.
- [ ] **Phase 1: deploy the separate Netlify site and complete an end-to-end smoke test.**
  Use only the fork deployment credentials and custom domain. Exercise the imported
  `vamsi` snapshot plus another fixed account without pointing at production services.
- [x] **Phase 2A: write the identity/multi-tenancy ADR before implementation.** Decide the
  account/session model and ownership enforcement, then cover every table, query, file,
  worker call, API key, onboarding flow, password reset, and rate/spend boundary.
- [x] **Phase 2A: implement and verify fixed-account multi-user isolation.** Add
  cross-user denial tests, migrate singleton rows, and keep public signup disabled.
- [ ] **Phase 2B: complete public-account security gates.** Add self-service signup,
  verified password recovery, session controls, credential encryption at rest, encrypted
  off-host backup handling, and abuse/rate/spend controls before enabling public access.
- [x] **AI Apply Navigator Phase 1: all linked jobs + known-fact fallback.** Add the
  uncapped assignment queue, twenty-row Chrome handoff, Needs-review flow, exact-file
  use when available, extension-first autofill, and AI fallback for missed fields backed
  by saved candidate facts (ADRs 0093–0095).
- [x] **AI Apply Navigator Phase 2 foundation: ApplyPilot plugin + MCP.** Bundle the
  queue workflow as a repo-local Codex plugin with five narrow MCP tools, revocable
  two-hour UUID-scoped runs, extension-first Chrome instructions, and a copied-prompt
  fallback (ADR 0096). This is implemented on `develop` for review, not yet installed or
  deployed.
- [ ] **AI Apply Navigator Phase 2 hardening: durable native invocation.** Replace the
  temporary environment-token setup with OAuth/device authorization, add run leases and
  per-step audit evidence, evaluate success detection and prompt-injection handling, and
  package/install the reviewed plugin. Keep unknown-answer and visible-success evidence
  explicit; see `docs/APPLYPILOT-PLUGIN-PLAN.md`.

A living, do-it-one-by-one checklist from a full-codebase review (token efficiency,
performance, correctness, UX). Work top-to-bottom unless priorities change.

## How to work this list
1. Pick the top unchecked item. Read its **Fix** and **Files**.
2. Make the change. Verify with the gates that apply:
   - App/TS: `npm run typecheck` · `npm run test` · `npm run build`
   - Worker (`resume-worker/*`): `node --check <file>` (+ `node render-sample.js` for render/template changes)
3. Tick the box here, and append a one-line note to the latest `docs/devlog/DAY-*.md`.
4. Commit (conventional commit, *why* in the body). Fork development stays on
   `multi-user-fork`; do not merge production backend configuration from `main`.

## Current release state (verified 2026-07-15)

- The independent backend and fixed-account/RLS foundation are live on the server laptop.
- The development `vamsi` account contains the owner-authorized ADR 0097 test transfer:
  Candidate Profile/Base résumé plus twelve recent real unapplied applications and 24
  verified PDF objects. This is a one-time private test fixture, not synchronization;
  Pilot 2/Pilot 3 and production were untouched.
- UUID-isolated Claude and ChatGPT subscription connections plus the centralized Candidate
  Profile controls are implemented; credential encryption remains a Phase 2B gate.
- The owner-authorized ADR 0087 snapshot is present under `vamsi` and verified through
  RLS/storage denial tests. The source itself was missing 999 historic application PDF
  references (591 résumé and 408 cover-letter files); all 285 physical objects were copied.
- The separate Netlify site and its end-to-end smoke test remain an explicit deployment gap.
- Worker code changes go live only after the isolated `com.jobpilotmulti.*` worker restarts;
  app changes go live only after a push and successful Netlify build.

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
  - Why: dedup is `onConflict: 'url'` ([apify-webhook/route.ts:86](../app/api/apify-webhook/route.ts#L86))
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
- [x] **C. Prompt-cache the scoring résumé + rubric prefix.** *(ADR 0056/0066)*
  - Why: `buildScoreMessages` ([scoring.ts:132](../lib/scoring.ts#L132)) puts the stable
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
    ([jobs/route.ts:30](../app/api/jobs/route.ts#L30)), shipping multi-KB `full_description`
    + `score_reasoning` the list never shows until a row is expanded → multi-MB payloads
    on every Jobs/Past load.
  - Fix: select only the columns the list/badges need; fetch the heavy detail fields
    lazily on row-expand (extend an existing detail fetch, or a `?id=` detail endpoint).
    Keep `idsOnly` path as-is.
  - Verify: Jobs page network payload drops sharply; expanding a row still shows the full
    description + reasoning.

## P3 — Smaller wins
- [ ] **I. Resolve historic application rows whose source PDFs no longer exist.**
  - Why: the owner snapshot preserved all 714 application rows, but the source storage
    already lacked 591 referenced résumé PDFs and 408 cover-letter PDFs. Fifty-eight of
    the 285 surviving physical objects are not referenced by a current application.
  - Fix: decide whether to regenerate documents from preserved structured data, mark the
    unavailable links clearly in the UI, and separately archive/delete only proven orphan
    objects. Never invent a file or silently drop application history.
  - Verify: every displayed download either resolves to a UUID-scoped file or has an
    explicit unavailable state; cross-user signing remains denied.

- [ ] **E. Render the tailored job title (`basics.label`) on the PDF.**
  - Why: tailoring computes/stores `basics.label`, and the `.label` CSS exists in
    [templates.js](../resume-worker/templates.js), but the header only draws `.name` +
    `.contact` — the headline (e.g. "Senior Frontend Engineer") never appears.
  - Fix: add `<div class="label">${esc(b.label||'')}</div>` to the header (between name
    and contact) when `b.label` is present. Worker change → re-render sample + redeploy.
  - Verify: `node render-sample.js` shows the label; still one page.
- [x] **F. Prompt-cache the assistant system prompt (full profile JSON each turn).** *(ADR 0069)*
  - Why: `buildAssistantSystem` ([assistant.ts:88](../lib/assistant.ts#L88)) embeds the whole
    profile JSON in the system prompt every turn — stable across the conversation.
  - Fix: mark the system block cacheable (once the assistant route uses the array-content
    path). Medium value; lower priority than C.
  - Verify: typecheck + tests; cache reads non-zero on multi-turn Anthropic chats.

## P4 — UX / maintainability (subjective; confirm with user before doing)
- [ ] **G. Reduce nav from 9 items to a clearer funnel.**
  - Why: [AppShell.tsx:11](../components/AppShell.tsx#L11) lists Dashboard, Jobs, Tailor &
    Apply, Past Jobs, Inbox, Tracker, Assistant, Profile, Settings. The core path is
    Jobs → Tailor & Apply; the rest are secondary.
  - Fix (proposal): group secondary items (e.g. Inbox + Tracker under one "Activity" area;
    fold Profile into Settings). Get user sign-off on grouping before implementing.
- [ ] **H. Split the monolithic pages.**
  - Why: [settings/page.tsx](<../app/(app)/settings/page.tsx>) ≈ 1,621 lines,
    [jobs/page.tsx](<../app/(app)/jobs/page.tsx>) ≈ 1,428 lines — hard to evolve.
  - Fix: extract per-section components (Settings especially). Not user-facing; do when
    touching those pages anyway.

---

## Done
- [x] **Clickable contact links in the résumé PDF** (2026-06-23). `resume-worker/templates.js`:
  phone → `tel:`, email → `mailto:`, LinkedIn/GitHub/website → `https://` (bare handles get a
  scheme), project URL linked; anchors styled to read as plain text. Verified via
  `node render-sample.js` (PDF carries `/URI` annotations, still one page). **Needs worker redeploy.**
