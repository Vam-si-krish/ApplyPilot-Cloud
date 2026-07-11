# ApplyPilot résumé worker (ADR 0024 · Phase 3)

Renders an application's **tailored résumé JSON** into a polished, **one-page, ATS-readable PDF**
(Puppeteer + HTML/CSS, auto-fit-to-one-page) and uploads it to the Supabase `resumes` bucket. Runs on an
always-on Mac; the Netlify app calls it over a Cloudflare Tunnel (Phase 4).

## Why a separate service
Puppeteer/Chromium (~150 MB, cold starts) and the multi-pass fit loop don't fit serverless limits. This is a
plain Node process you run on a machine that's always on. It only **renders** — tailoring (the LLM call)
already happens in the Next app and is stored on `applications.tailored_resume`.

## Run locally
```bash
cd resume-worker
npm install                 # downloads a headless Chromium (one-time, ~150 MB)
npm run sample              # renders sample-classic.pdf + sample-modern.pdf (no Supabase needed)
cp .env.example .env        # then fill in WORKER_SECRET + SUPABASE_SERVICE_ROLE_KEY
npm start                   # worker on :8787
```

## Endpoints
- `GET /health` → `{ ok, browser }`
- `POST /generate` `{ "id": "<application uuid>" }` with header `Authorization: Bearer <WORKER_SECRET>`
  → renders that application's `tailored_resume`, uploads `resumes/<id>.pdf`, sets the row `ready` + `pdf_path`.

## Auto-fit
The whole document scales off one CSS var (`--scale`). `render.js` binary-searches the **largest** scale that
still produces a **single page** (page count read from the real PDF via `pdf-lib`), with a readable floor
(~9.5 pt). If content overflows even at the floor it renders at the floor and returns `tooLong: true` so the
UI can suggest trimming — never a silent page 2.

## Templates
`templates.js` — `classic` (serif) and `modern` (sans, navy accent). Single-column, semantic `<h2>` sections,
real selectable text, standard fonts, no icons/columns → ATS-parseable.

## Deploy to the always-on server laptop (Phase 4)
Copy this folder, `npm install`, set `.env`, run under a launchd plist (auto-restart on boot), and expose it
with a named Cloudflare Tunnel (e.g. `worker.vamsikrish.com → localhost:8787`). Put `RESUME_WORKER_URL` +
`RESUME_WORKER_SECRET` in the Netlify env. Same code as the dev laptop.
