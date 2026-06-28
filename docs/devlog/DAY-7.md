# Devlog — Day 7 (2026-06-28) · START HERE for the new session

## ✅ Shipped this session: Claude-subscription AI mode (ADR 0042)
Added the option to run AI on the user's Claude Pro/Max **subscription** (via the Claude
Agent SDK on the worker) instead of a paid third-party API key — selectable **per task**.
Code complete; `npm run typecheck && npm run test` green. **Not live until the worker is
set up + the app is deployed.**

### What landed
- **Pseudo-provider `'subscription'`** selectable in Settings → AI Models for **Scoring**
  and **Tailoring** (reuses `score_provider`/`tailor_provider` + `*_model` holding an
  Agent-SDK alias `sonnet|opus|haiku`). Set both = everything on the plan; mix to keep
  cheap API scoring + subscription tailoring. No DB migration.
- **Cloud app**
  - `lib/llm.ts` — new `WorkerLLMClient extends LLMClient` (overrides `chat` to POST the
    worker `/llm`), `makeWorkerClient`, `SUBSCRIPTION_PROVIDER` const.
  - `lib/scoreRunner.ts` — `buildClientForTask` special-cases `'subscription'` → returns a
    `WorkerLLMClient` (worker url+secret from settings→env, same as the render proxy);
    **throws** if the worker is unconfigured (never silently falls back to a paid key →
    for scoring that's a visible score-0).
  - `app/(app)/settings/page.tsx` — added the provider/model options + a helper line about
    the worker requirement and the **monthly Agent-SDK credit cap**.
  - `lib/types.ts` — doc comment only.
- **Worker** (`resume-worker/`)
  - `agentClient.js` (new) — `makeAgentClient(model)` with the same `.chat()` contract;
    runs SDK `query()` with `maxTurns:1`, custom `systemPrompt`, no tools, `settingSources:[]`,
    and an env that **strips `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN`** (else they bill the API).
  - `server.js` — new `POST /llm {messages,model,temperature,maxTokens}→{text}`; shared
    `resolveTaskClient(provider,model)`; `/tailor`, `/cover-letter`, `/generate` (condense)
    now use it so they run on the subscription when tailor provider = `subscription`.
  - `@anthropic-ai/claude-agent-sdk` added to deps (installed; `query` import verified).
  - `.env.example` + `SETUP.md` §6 — one-time `claude setup-token` → `CLAUDE_CODE_OAUTH_TOKEN`.

### Billing reality baked in (changed 2026-06-15)
Agent-SDK usage draws from a **separate monthly credit pool** (Pro $20 / Max5× $100 /
Max20× $200), then **standard API rates** — not unlimited. Surfaced in the Settings helper,
SETUP.md, and ADR 0042. Recommendation: high-volume scoring on a cheap API model, subscription
on tailoring.

## How to verify (end-to-end, needs the Mac worker)
1. `npm run typecheck && npm run test` (done — green).
2. On the worker Mac: `npm i` (pulls the SDK); `claude setup-token` → put token in `.env`
   as `CLAUDE_CODE_OAUTH_TOKEN`; ensure **no** `ANTHROPIC_API_KEY` in the worker env; restart;
   `curl -H "Authorization: Bearer <secret>" -H 'Content-Type: application/json' \
    -d '{"model":"haiku","messages":[{"role":"system","content":"Reply with: SCORE: 7"},{"role":"user","content":"hi"}]}' \
    https://worker.vamsikrish.com/llm` → `{"text":"SCORE: 7"}`.
3. App: Settings → AI Models → Scoring = "Claude subscription", Save → "Score selected" on a
   few jobs → real scores, **no usage on the API dashboards**. Then Tailoring = subscription →
   generate an application → tailored résumé + PDF.

## Open questions / follow-ups
- **Temperature/max_tokens** aren't controllable via the SDK — subscription calls run at model
  defaults (scoring normally 0.1). Watch eval drift if scoring is moved onto the subscription.
- **Latency:** one `claude` subprocess spawn per `/llm` call. Fine for daily volumes; a warm
  process/session pool on the worker is the deferred optimization if high-volume scoring is run
  this way.
- Consider a tiny **`GET /llm/health`** (or extend `/health`) that reports subscription auth
  status so the app can warn before a run if the worker isn't logged in.
