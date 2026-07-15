# ApplyPilot résumé worker

Renders an application's **tailored résumé JSON** into a polished, **one-page, ATS-readable PDF**
(Puppeteer + HTML/CSS, auto-fit-to-one-page), runs subscription-backed LLM work, and uploads through the
configured storage protocol. In `multi-user-fork` it runs at `127.0.0.1:8233` behind the independent
gateway and Tailscale Funnel `/jobpilot/worker`; the Netlify app never accepts a user-selected endpoint.

## Why a separate service
Puppeteer/Chromium (~150 MB, cold starts) and the multi-pass fit loop don't fit serverless limits. This is a
plain Node process you run on a machine that's always on. It renders and hosts long-running AI work,
including optional Claude/ChatGPT subscription backends that cannot run in a serverless function.

## Run locally
```bash
cd resume-worker
npm install                 # downloads a headless Chromium (one-time, ~150 MB)
npm run sample              # renders sample-classic.pdf + sample-modern.pdf (no backend needed)
npm test
```

For the isolated fork, install and operate the worker through the
[backend runbook](../backend/README.md). The standalone `.env` and port-8787 instructions
in `SETUP.md`/`DEPLOY.md` describe the legacy production topology, not this fork.

## Endpoints
- `GET /health` → `{ ok, browser }`
- `GET /version` → deployed commit + feature markers
- `POST /llm` → one authenticated subscription completion (Claude Agent SDK or ChatGPT/Codex SDK)
- `GET/POST/DELETE /claude-connection/*` → per-user Claude subscription PKCE login, status, and disconnect
- `GET/POST/DELETE /chatgpt-connection/*` → per-user ChatGPT/Codex device login, status, and disconnect
- `POST /score-jobs` → background subscription scoring for selected jobs
- `POST /tailor` / `POST /tailor-queue` → tailor one application / drain the queue
- `POST /generate` `{ "id": "<application uuid>" }` with header `Authorization: Bearer <WORKER_SECRET>`
  and `x-jobpilot-user-id: <account uuid>` → resolves only that user's application,
  renders it, uploads to the UUID-namespaced storage path, and marks the row ready.

## Auto-fit
The whole document scales off one CSS var (`--scale`). `render.js` binary-searches the **largest** scale that
still produces a **single page** (page count read from the real PDF via `pdf-lib`), with a readable floor
(~9.5 pt). If content overflows even at the floor it renders at the floor and returns `tooLong: true` so the
UI can suggest trimming — never a silent page 2.

## Templates
`templates.js` — `classic` (serif) and `modern` (sans, navy accent). Single-column, semantic `<h2>` sections,
real selectable text, standard fonts, no icons/columns → ATS-parseable.

## Multi-user isolation

Every fork request carries a gateway-authenticated account UUID. Database/storage clients
are scoped to it, Claude uses only `CLAUDE_CONFIG_DIR` under that UUID, ChatGPT uses only
file-backed `CODEX_HOME` under that UUID, and there is no cross-user credential fallback.
Generated object paths are namespaced by the same UUID.
The fork service is installed/restarted as `com.jobpilotmulti.worker` by `backend/scripts/`.
