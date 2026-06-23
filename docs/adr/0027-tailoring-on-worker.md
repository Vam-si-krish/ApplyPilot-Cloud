# ADR 0027 — Run résumé tailoring on the worker, not a Netlify route

## Status
Accepted (2026-06-23)

## Context
`POST /api/applications/[id]/generate` ran the per-job résumé tailoring inline: one
LLM call (`tailorResume`, ~4000 output tokens, Sonnet) inside the serverless
request. Once a real LLM key was added to the vault, the call actually ran — and a
4000-token generation takes 30–90s.

Netlify caps **synchronous** functions at ~26s (10s default). The route declared
`export const maxDuration = 60`, but `maxDuration` is a Vercel concept that Netlify
ignores. So Netlify killed the function mid-call and returned a **502 Bad Gateway**
(`content-type: text/plain`, from the platform — not our JSON error path). No
synchronous approach fits: even a smaller model rarely finishes 4000 tokens under
26s for real résumés/descriptions.

This is the same class of problem already solved for fetch+score (async webhook +
chunked batches) and for PDF rendering (offloaded to the always-on `resume-worker`
because Puppeteer can't run serverless).

## Decision
Move the tailoring LLM call to the **résumé worker** (the always-on Mac, reached
over the existing Cloudflare Tunnel + shared Bearer secret — same path `/render`
already uses). The worker has no serverless timeout.

- New worker endpoint `POST /tailor {id}`: validates cheap preconditions
  synchronously (application/job exist, base résumé present, tailoring
  provider+model resolvable, active vault key present) and returns those as fast
  4xx errors; then marks the row `generating`, **acks 202 immediately**, and runs
  the LLM call in the background, finally writing `tailored_resume` +
  `tailor_changes` + status `ready`/`failed`.
- `/api/applications/[id]/generate` becomes a thin proxy to `/tailor` (mirroring
  `/render` → `/generate`) and returns 202 right away — well under Netlify's limit
  because the worker acks before the slow call.
- The Applications UI no longer awaits the LLM result; it **polls the row** until
  `ready`/`failed`.
- The tailoring logic (`lib/resumeTailor.ts`), the multi-provider LLM client
  (`lib/llm.ts`), and the résumé normalizers (`lib/resume.ts`) are ported into
  `resume-worker/tailor.js` as a faithful hand-kept copy. Vault keys are plaintext
  in `api_keys`, so the worker resolves them via its existing service-role client
  (`getActiveApiKey`), with its own env var as fallback.

## Consequences
- Generation no longer 502s on Netlify; it survives calls of any length.
- Generation now depends on the worker being online (PDF rendering already did).
  When the worker is down, the route returns a clear 502 ("worker did not respond —
  is it running?") instead of a silent platform 502.
- `resume-worker/tailor.js` duplicates app logic. It must be kept in sync with
  `lib/resumeTailor.ts` / `lib/llm.ts` / `lib/resume.ts` by hand; the scoring
  discipline and ADR 0026 tailoring rules still apply.
- The verifiable-facts anchoring (employers/titles/dates/education via
  `mergeTailored`) is unchanged — it just runs in a different process.
