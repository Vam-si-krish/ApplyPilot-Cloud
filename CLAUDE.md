# CLAUDE.md — ApplyPilot-Cloud

A private multi-user, password-protected web app that **runs itself daily**:
it fetches recent job postings through Apify, scores each 0–10 for fit against
the authenticated user's résumé, and supports shortlisting, tailoring, cover
letters, inbox tracking, and application tracking. For prepared external jobs, ADRs 0093
through 0095 add an **AI navigation handoff** for every unapplied job with a link: the
installed extension fills first, then a user-invoked Chrome agent may fill missed fields
from saved candidate facts, click through, submit, verify visible success, and leave
unknown-answer tabs in Needs review while continuing. The app does not silently launch a
browser run or invent absent candidate information.
When the employer site visibly identifies the exact job as already applied, the agent
must not submit it again; it records that application and its linked job as Applied.
Uncertain completion or human-judgment blockers go to Needs review (ADR 0100).

ADRs 0096 and 0099 establish the long-term ApplyPilot Codex plugin path. `plugins/applypilot/` bundles
the Chrome workflow and a local stdio MCP server. Its API access is a revocable two-hour
run tied to the signed-in user's UUID; it never uses database credentials, backend
service keys, app session cookies, or browser-displayed bearer tokens. A ten-minute,
single-use pairing code connects the local process and remains harmless after use. The copied twenty-row prompt remains a rollout
fallback.

## Active branch direction: independent multi-user product

`multi-user-fork` is the foundation of a **new application**, not another frontend for
the existing ApplyPilot production database. The accepted roadmap is [ADR 0072](docs/adr/0072-independent-multi-user-fork-foundation.md):

- **Phase 1 (complete):** isolated database, API, file store, worker, credentials,
  public path, services, recovery, and backups on the server laptop.
- **Phase 2A (implemented/current private release):** three fixed `APP_USERS_JSON` accounts, signed identity sessions,
  forced database RLS, per-user files/keys/jobs/settings, and PDF résumé onboarding. Public
  signup is deferred; normal work uses each account's own Apify/LLM keys or its own
  connected UUID-isolated Claude or ChatGPT subscription (ADRs 0074 and 0081).

The fork must never point at, continuously share, or synchronize with the production
backend. ADR 0087 records one explicit owner-authorized cutover exception: a verified
snapshot of the original owner account was copied into the isolated `vamsi` UUID while
deployment-owned worker credentials stayed separate. The two products remain independent
after that cutoff. The frontend deploys separately on Netlify; persistent services stay
on the server laptop.

Normal development happens from a personal laptop per ADR 0088. A clean push to
`multi-user-fork` triggers Netlify and the server's five-minute autopull; the guarded
`scripts/jobpilot-server` CLI can request an immediate sync, bounded restart/status/logs,
backup, or protected local-dev environment over a pinned Tailscale SSH connection. Its
dedicated key is forced to `backend/scripts/remote-control.sh` and never grants a shell.

ADR 0089 makes `multi-user-fork` the production branch and `develop` the integration
branch. Development has its own database, ports `8241`–`8243`, `/jobpilot-dev` Funnel
path, files, secrets, backups, and `com.jobpilotdev.*` services. Use a separate local
worktree and `scripts/jobpilot-dev-server`; never test against the production backend.
ADR 0097 records one explicit owner-authorized testing exception: a guarded, read-only
production → development API transfer populated only the development `vamsi` Candidate
Profile/Base résumé and twelve bounded real applications. It reset operational state and
copied available files into `imports/production/`; it is not synchronization and does
not authorize copying another account, credentials, settings, mail, OAuth/subscription
state, or runs.

## The rule that matters (scoring discipline)
**Scoring is deliberate, never fabricated.** As of **ADR 0022** the scorer is a v2 weighted,
must-have-aware, owner-neutral rubric (`SCORE_PROMPT` in `lib/scoring.ts`) — it intentionally **diverges** from the
ApplyPilot-Lite scorer (the old "copy it byte-for-byte" rule is retired; see ADR 0022). What still
holds, non-negotiably: **exactly one LLM call per job**; the model scores 0–10 and the threshold/sort
decides; a parse failure or LLM error yields score `0` (visible), **never a fabricated score**; output
is line-prefixed and parsed defensively (clamped 0–10, extra fields optional). The request is the
current user's Base résumé + explicit work-authorization/scoring-preference facts + job — description HTML-stripped
then truncated to 15000 chars, with the candidate context marked as a prompt-cache breakpoint
(ADRs 0056 and 0080). Missing eligibility facts remain unknown. The scorer also reports
`employment_type` (so contract roles are flagged, not demoted) and a sub-score `breakdown`. Eval cases
(`evals/cases/`) are the regression net — keep them green when touching scoring.

Candidate trade-offs are bounded values, not editable system prompts (ADR 0083).
Candidate Profile may choose the learnable-skill horizon, skill/title/evidence tailoring
policy, experience-gap tolerance, overqualification handling, and contract-role treatment.
Those values never override the protected scoring parser/rubric, eligibility proof,
verified facts/tenure, review disclosure, or one-page constraints.

Canonical flow: `Cron → /api/run (start Apify async) → Apify webhook → /api/apify-webhook
(insert unscored) → /api/score-batch (chunked scoring loop) → user reads scored jobs`.

## Map
| Path | What lives there |
|---|---|
| `app/` | Next.js App Router: pages (Dashboard, Jobs, Profile, Settings, login) + `app/api/*` routes |
| `lib/llm.ts` | Multi-provider LLM client (Gemini/OpenAI/DeepSeek/Anthropic) — port of Lite `llm.py` |
| `lib/scoring.ts` | `SCORE_PROMPT`, `scoreJob`, `parseScoreResponse` — port of Lite `scorer.py` |
| `lib/apify.ts` | Apify actor start + input mapping (keywords×locations, last-24h) |
| `lib/companyAssessment.ts` | Per-company apply-channel/trust verdicts (ADR 0101): batched LLM assessment, shared cache, job stamping |
| `lib/supabase.ts` | REST/storage protocol clients; fork uses `BACKEND_*`, production keeps legacy env fallback |
| `lib/auth.ts` | Fixed-account credential validation + identity session sign/verify |
| `lib/workerConfig.ts` | Trusted worker resolution; deployment-only in the multi-user fork |
| `lib/candidatePreferences.ts` | Normalize and purpose-limit Candidate Profile application/scoring/tailoring preferences |
| `components/ResumePaper.tsx` | Shared print-like browser canvas for Base/tailored editing and contextual change review |
| `lib/types.ts` | Shared TS types, including standard + user-defined résumé sections |
| `lib/resume.ts` | Defensive résumé normalization and scoring/assistant text serialization |
| `middleware.ts` | Gates routes and replaces caller identity headers from the signed session |
| `plugins/applypilot/` | Codex plugin manifest, Apply jobs skill, and dependency-free stdio MCP server |
| `lib/aiAgentAuth.ts` + `lib/aiAgentPairing.ts` + `app/api/ai-agent/*` | Single-use pairing, short-lived MCP authorization, and purpose-limited user-scoped tools |
| `supabase/migrations/` | SQL schema (jobs, profile, settings, runs) |
| `backend/` | `multi-user-fork` server API, storage, migrations, launchd/autopull/watchdog/backup |
| `scripts/jobpilot-server` | Personal-laptop bootstrap, deploy, status, restart, logs, and backup CLI |
| `evals/cases/` | Labeled resume+job → expected-score regression cases |
| `evals/company-cases/` | Labeled company+posting → expected apply-channel/trust cases (ADR 0101) |
| `docs/` | PRD, ARCHITECTURE, ADRs, devlog (read before non-trivial changes) |

## Commands
```bash
npm run dev          # local dev server (http://localhost:3000)
npm run build        # production build
npm run typecheck    # tsc --noEmit
npm run test         # vitest (scoring parser + LLM + evals)
npm run docs:check   # Markdown links + required living-document workflow
# npm run lint is not configured yet; Next currently opens an interactive prompt
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
- **Architecture and documentation are risk-proportionate gates.** Follow `AGENTS.md`
  and `docs/DEVELOPMENT.md`: use task-scoped context, update living docs when reality
  changes, and record Standard/High-risk implemented slices in the devlog.

## Context docs (task-scoped for Standard/High-risk changes)
- `docs/devlog/` — latest DAY-N holds current state and open questions.
- `docs/DECISIONS.md` — route from the affected surface to current ADRs without scanning
  the directory.
- `docs/PRD.md` — read the relevant product section only.
- `docs/ARCHITECTURE.md` — read the relevant boundary/data-flow section only.
- `docs/adr/` — read routed decisions; add an ADR when making or reversing a durable choice.
- `docs/AI_WORKFLOW.md` — how AI assistance is used and verified here.
- `docs/DEVELOPMENT.md` — mandatory architecture/documentation definition of done.
- `git log` — every change carries its *why* in the body.

## Source of truth
Current code plus accepted, non-superseded ADRs are authoritative. `docs/PRD.md` and
`docs/ARCHITECTURE.md` are the living product/technical summaries and must be kept in
sync. `../ApplyPilot-Lite/` is historical reference material only; scoring intentionally
diverged in ADR 0022 and later decisions.
