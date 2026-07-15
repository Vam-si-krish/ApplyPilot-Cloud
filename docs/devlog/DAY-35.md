# DAY 35 — 2026-07-15 (All jobs and AI fallback fields)

## Owner request

- Let every job move into Assign to AI, not only prepared External Apply rows.
- Let the extension fill first, then let AI complete missed fields from known candidate
  information.
- When the answer is unknown, mark Needs review, leave the tab aside, and continue with
  the next job in a new tab. Keep the instructions short.

## Implementation

- Expanded assignment to every unapplied row with a usable HTTP(S) link, including Easy
  Apply, LinkedIn, queued, ungenerated, and missing-PDF rows.
- Removed the five-active-row queue cap. The copied prompt processes the next twenty
  assigned jobs while all remaining rows stay in the queue.
- Added concise known-fact fallback filling from Candidate Profile, saved application
  answers, résumé, and cover letter.
- Relabeled blockers as Needs review and instructed the browser run to record the missing
  field, leave the tab open, and continue in a new tab.
- Recorded the amended product boundary in ADR 0095.

## Verification

- Focused eligibility, lifecycle, route, prompt, and UI-contract tests plus TypeScript
  pass.
- Full gates pass: 218 application tests with 9 credentialed evals skipped, 16 backend
  tests, 20 worker tests, TypeScript, documentation validation across 141 Markdown files
  and 89 ADRs, and the production-mode Next.js build.
- The isolated development server verified application commit `429d90d` with a healthy
  gateway/worker and clean checkout. Its push triggered the normal development Netlify
  build; it was not polled, per the owner handoff. Production remains untouched.

## ApplyPilot plugin/MCP foundation (uncommitted review work)

### Owner request

- Start the long-term improvement path as an ApplyPilot Codex plugin with MCP tools.
- Work only in development and do not commit the changes.

### Implementation

- Scaffolded `plugins/applypilot/` with a manifest, bundled Apply jobs skill, local stdio
  MCP server, five purpose-limited tools, and no marketplace/install side effects.
- Added signed, purpose-bound two-hour tokens backed by revocable forced-RLS
  `ai_agent_runs` rows. The MCP APIs recover the token UUID and re-enter the existing
  gateway as that user; service keys, database credentials, and webpage cookies never
  enter the plugin.
- Added live queue/context endpoints, shared lifecycle mutation logic, and a one-click
  development setup handoff in Assign to AI. The copied batch prompt remains a fallback.
- Recorded the trust boundary in ADR 0096 and the staged OAuth, leasing/audit,
  evaluation, and packaging work in `docs/APPLYPILOT-PLUGIN-PLAN.md`.

### Verification

- Plugin manifest validation and the dependency-free MCP handshake pass.
- Full gates pass: 223 application tests with 9 credentialed evals skipped, 16 backend
  tests, 20 worker tests, TypeScript, documentation validation across 145 Markdown files
  and 90 ADRs, and the production-mode Next.js build.
- No commit, push, migration, deployment, marketplace entry, or plugin installation was
  performed. All work remains an uncommitted `develop` review diff.

## Owner production data for development plugin testing

### Owner request

- Copy the production `vamsi` résumé and Candidate Profile details into testing.
- Add a bounded set of real `vamsi` production applications for realistic testing while
  leaving every other profile untouched.

### Implementation

- Added ADR 0097 and `scripts/copy-owner-to-development.mjs`, a dry-run-first API-to-API
  transfer guarded to `/jobpilot` → `/jobpilot-dev` and the fixed `vamsi` UUID.
- Copied only Candidate Profile/Base résumé fields and twelve recent unapplied linked
  applications, prioritizing rows with tailored résumés/PDFs. Settings, credentials,
  keys, mail, Gmail/OAuth, subscription sessions, runs, and fixed-login secrets were
  excluded.
- Removed production run/duplicate relationships and reset clicked, applied, parked, and
  AI Apply state. Imported files use the development-only `imports/production/` namespace.

### Verification

- Production and development backups completed before the transfer.
- Policy tests and the read-only dry run passed before execution.
- Execution verified one `vamsi` profile, twelve jobs/applications, UUID ownership, null
  applied/AI state, and SHA-256 equality for all 24 copied PDF objects; no referenced
  source file was missing.
- The source API was read-only. Pilot 2 and Pilot 3 were not modified; a post-transfer
  read-only count confirmed zero imported applications for each. No commit, push,
  migration, deployment, or ongoing synchronization was created.
- Final gates pass: 223 application tests with 9 credentialed evals skipped, 19 backend
  tests, 20 worker tests, TypeScript, plugin validation, documentation validation across
  146 Markdown files and 91 ADRs, and the production-mode Next.js build.
