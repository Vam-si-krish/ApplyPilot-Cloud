# CLAUDE.md — ApplyPilot-Cloud

A single-user, password-protected web app that **runs itself daily in the cloud**:
it fetches the last 24h of job postings (via Apify), scores each 1–10 for fit
against the user's resume (via an LLM), and shows a sorted shortlist. It does
**not** auto-apply. It is a cloud-native rewrite of the *fetch + score* half of
`../ApplyPilot-Lite/`, keeping scoring behaviour identical.

## The rule that matters (scoring discipline)
**Scoring is deliberate, never fabricated.** As of **ADR 0022** the scorer is a v2 weighted,
must-have-aware rubric (`SCORE_PROMPT` in `lib/scoring.ts`) — it intentionally **diverges** from the
ApplyPilot-Lite scorer (the old "copy it byte-for-byte" rule is retired; see ADR 0022). What still
holds, non-negotiably: **exactly one LLM call per job**; the model scores 0–10 and the threshold/sort
decides; a parse failure or LLM error yields score `0` (visible), **never a fabricated score**; output
is line-prefixed and parsed defensively (clamped 0–10, extra fields optional). The user-message is
still resume + job with the description truncated to 15000 chars. The scorer also reports
`employment_type` (so contract roles are flagged, not demoted) and a sub-score `breakdown`. Eval cases
(`evals/cases/`) are the regression net — keep them green when touching scoring.

Canonical flow: `Cron → /api/run (start Apify async) → Apify webhook → /api/apify-webhook
(insert unscored) → /api/score-batch (chunked scoring loop) → user reads scored jobs`.

## Map
| Path | What lives there |
|---|---|
| `app/` | Next.js App Router: pages (Dashboard, Jobs, Profile, Settings, login) + `app/api/*` routes |
| `lib/llm.ts` | Multi-provider LLM client (Gemini/OpenAI/DeepSeek/Anthropic) — port of Lite `llm.py` |
| `lib/scoring.ts` | `SCORE_PROMPT`, `scoreJob`, `parseScoreResponse` — port of Lite `scorer.py` |
| `lib/apify.ts` | Apify actor start + input mapping (keywords×locations, last-24h) |
| `lib/supabase.ts` | Server (service-role) + browser (anon) Supabase clients |
| `lib/auth.ts` | Shared-password session cookie sign/verify |
| `lib/types.ts` | Shared TS types for jobs/profile/settings/runs |
| `middleware.ts` | Gates every route behind the password session |
| `supabase/migrations/` | SQL schema (jobs, profile, settings, runs) |
| `evals/cases/` | Labeled resume+job → expected-score regression cases |
| `docs/` | PRD, ARCHITECTURE, ADRs, devlog (read before non-trivial changes) |

## Commands
```bash
npm run dev          # local dev server (http://localhost:3000)
npm run build        # production build
npm run typecheck    # tsc --noEmit
npm run test         # vitest (scoring parser + LLM + evals)
npm run lint         # next lint
```

## Conventions
- **TypeScript everywhere.** Validate every external boundary: LLM output (parser
  clamps 0–10), Apify dataset items, and request bodies before touching the DB.
- **Secrets** come from env only (see `.env.example`); never commit `.env.local`.
  The service-role key and LLM keys are server-only — never imported into a client component.
- **Serverless timeouts:** never fetch + score in one request. Apify runs async via
  webhook; scoring is chunked (`SCORE_BATCH_SIZE` jobs/invocation) and re-triggers
  until the unscored queue is empty.
- Conventional commits with the *why* in the body (`feat(scope): …`).

## Context docs (read before non-trivial changes)
- `docs/devlog/` — **start here in a new session**: latest DAY-N holds current state
  + open questions. Append before ending a session.
- `docs/PRD.md` — what we're building and why.
- `docs/ARCHITECTURE.md` — pipeline + data flow + module boundaries.
- `docs/adr/` — decisions with trade-offs; add an ADR when you make or reverse one.
- `docs/AI_WORKFLOW.md` — how AI assistance is used and verified here.
- `git log` — every change carries its *why* in the body.

## Source of truth
`../ApplyPilot-Lite/` is authoritative for scoring logic, the LLM client behaviour,
the data model, and the UI design. When in doubt, open it.
