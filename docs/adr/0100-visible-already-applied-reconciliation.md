# ADR 0100: Reconcile visibly already-applied jobs

- Status: accepted
- Date: 2026-07-16
- Amends: ADRs 0095, 0096, and 0099

## Context

The AI Apply workflow could record Applied only through a tool named
`mark_application_submitted`. That name correctly protected against marking a job done
from a button click, but it made a browser agent hesitate when LinkedIn or another
employer site visibly said **You applied** or **Already applied**. In that case, submitting
again is wrong, while leaving the row active makes ApplyPilot disagree with the source
site.

## Decision

- Replace the MCP tool name with `mark_application_applied` and require an explicit
  confirmation value: `submitted_now` or `already_applied`.
- Treat visible Applied, You applied, Application submitted, or Already applied status
  for the exact job as sufficient completion evidence. Do not submit that application
  again. Use the existing guarded `submitted` lifecycle transition so both the
  application and linked job receive the Applied status and timestamp.
- Continue requiring visible site evidence. Merely clicking Submit, seeing a generic
  application-history page, or inferring from the job URL is insufficient.
- When completion is uncertain, a required answer needs human judgment, or the site
  cannot be completed confidently, mark that exact application Needs review with a
  concise reason and continue to the next queue item.
- Update the copied fallback prompt and manual queue action to use the user-facing label
  Applied. The internal persisted `ai_apply_status = submitted` value remains unchanged
  for backward compatibility.

## Consequences

- ApplyPilot converges with visible employer-site state even when a prior application was
  made outside the current AI run.
- The tool records why completion was recognized without adding a new database state or
  migration. Per-step durable evidence remains part of the later audit phase.
- The Apply jobs skill and MCP tool rename require the development plugin cachebuster to
  be refreshed and a new Codex thread before testing.

## Verification

- Test both confirmation values in the bundled skill and require confirmation at the MCP
  boundary.
- Test that the fallback prompt explicitly avoids duplicate submission, marks visible
  already-applied jobs Applied, and retains Needs review behavior.
- Run application tests, TypeScript, documentation validation, build, plugin validation,
  and the backend/worker suites before development deployment.
