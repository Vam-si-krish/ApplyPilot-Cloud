# ADR 0030 — Tailor & Apply UX: apply tracking, PDF filenames, clearance gate

## Status
Accepted (2026-06-23)

## Context
Four rough edges in the apply flow:
1. The "Did you apply?" prompt only fired on the **Jobs** tab, not on the Applications
   tab — where you actually open the posting after tailoring a résumé.
2. "Applications" undersold the tab: it tailors a résumé, renders the PDF, and *then*
   you apply — it's not just a list.
3. Downloaded PDFs were named after the storage hash (`<uuid>.pdf`) and opened in a
   blank preview tab.
4. The user's funnel is: fetch ~600 → score all → keep the top ~100–150 → company-assess
   those → tailor only the good companies scoring >8. Jobs requiring security clearance
   or US citizenship/Green Card are a hard waste of time and should be filtered out
   early by the score, regardless of skill fit.

## Decision
- **Apply tracking parity.** The Applications (now "Tailor & Apply") tab gets the same
  `pendingApply` ref + `visibilitychange` "Did you apply?" dialog as Jobs; "Yes" marks
  the application `applied` (stamps `applied_at`).
- **Rename.** Tab + heading → **"Tailor & Apply"** (route stays `/applications` so links
  don't break).
- **Proper PDF filenames.** `/api/applications/[id]/pdf` builds
  `"<Name> - <Company> - Resume.pdf"` from the tailored résumé's name + the job company
  and passes it as the signed-URL `download` option (sets `Content-Disposition`). The
  client downloads via an `<a download>` click — direct download with a real name
  instead of a blank preview tab.
- **Clearance/citizenship gate (strengthened).** The fit scorer already had a Phase-1
  rule to score 1 for clearance/citizenship requirements; it's now a prominent HARD
  BLOCK with explicit synonyms ("US Citizen", "USC", "TS/SCI", "Public Trust",
  "Q clearance", "Green Card", ITAR "US Persons only", …): score **1** and stop, skill
  fit irrelevant (1, not 0 — 0 stays reserved for invalid/non-job content). New eval
  case `clearance-required.json` locks it (a strong skills match that must still score 1).

## Consequences
- Apply tracking is consistent across both tabs; the Tailor & Apply name reflects what
  the tab does.
- Recruiters get a properly named résumé file; the user gets a one-click download.
- Clearance/citizenship-restricted roles drop to the bottom of the funnel automatically,
  so the top-100 cut and the manual tailoring effort aren't wasted on them. The fit
  rubric itself (ADR 0022) is otherwise unchanged — it scores the base résumé; tailoring
  remains downstream, and the tailored résumé is scored separately (ADR 0029).
- No schema changes (code + prompt only).
