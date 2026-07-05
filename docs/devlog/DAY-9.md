# DAY 9 — 2026-07-05

## ✅ Mass-FAILED after quota exhaustion → never clobber a good résumé (ADR 0060)
User bulk-generated ~37 résumés; the subscription window died near the end and the UI
showed FAILED on **everything** — including rows with a finished résumé + PDF.

Diagnosis (from the `applications` table): all 37 failures carried the same
`Agent SDK error (account=2 … task=tailor): You've hit your usage limit` written 01:16–01:25,
33 of them with `tailored_resume`, `pdf_path`, AND `cover_letter_pdf_path` intact. So the
assets were fine; the *status* was the lie. Root causes: (1) every failure path on the
worker wrote `status='failed'` unconditionally, so a failed REgeneration/render demoted a
finished row; (2) bulk "Generate selected" re-tailored already-ready rows (select-all made
this easy); (3) out-of-quota errors fail in ~3s and nothing stopped the loop, so the whole
remaining batch got machine-gunned into FAILED.

Fixes:
- Worker: `markTailorFailure` keeps `status='ready'` (+ "Regenerate failed — kept the
  previous résumé" in `error`) whenever a résumé exists; `/generate` render failures also
  restore `ready`. The drain `break`s on `isUsageLimitError` — untouched rows stay `queued`.
- App: bulk Generate filters out rows that already have a résumé (button count + tooltip +
  skip toast); the client pool trips a breaker on limit-shaped `row.error` and reports
  "Stopped — Claude usage limit hit" instead of grinding on.
- Data repaired live: 33 failed-with-résumé → `ready`, 4 failed-without → `queued`; 0 failed.
- Tests 158 green; typecheck + build green; `node --check` on worker.

### ⚠ Deploy note
`resume-worker/server.js` changed — **must be redeployed on the Worker Mac** (the local
copy is not production). App-side changes ship with the next Netlify deploy.

### Open questions
- The 4 requeued rows still need a run once the window resets ("Run queue now" will pick
  them up — the drain now stops cleanly if the window is still dead).
- /api/jobs threw two ~8-9s 500s during yesterday's visual pass (slow Supabase query) —
  pre-existing, worth an index/query look.
