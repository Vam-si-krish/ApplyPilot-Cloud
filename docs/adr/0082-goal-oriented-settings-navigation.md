# ADR 0082 — Goal-oriented Settings navigation

**Status:** accepted · **Date:** 2026-07-15 · **Builds on:** ADRs 0078 and 0081

## Context

Settings had grown into one long page containing job discovery, scheduling, AI subscription
connections, task models, API keys, Gmail, filtering, destructive controls, and a legacy
worker override. Related controls were separated by unrelated sections, labels such as
“above” and “below” became inaccurate, and users had to scan the entire page to find one
setting. The mobile layout was particularly difficult to navigate.

Several explanations had also drifted from runtime behavior: the visible daily run-time
field did not control Netlify's deployment schedule, the pre-scoring description still
claimed a universal clearance penalty, and overnight tailoring claimed to perform a
second score that was removed in ADR 0050.

## Decision

Organize Settings by user goal and render only the selected category:

1. **Job Search** — roles, locations, skills, fetch limits/mode, pre-scoring filter,
   job portals, source-specific actors, and spend controls.
2. **Automation** — scheduled discovery participation, account timezone, and overnight
   tailoring.
3. **AI & Models** — Claude/ChatGPT subscription connections and the three task-model
   lanes, with a direct handoff to Candidate Profile for résumé facts, candidate answers,
   and scoring/tailoring guidance.
4. **Connections & Keys** — per-user provider keys, key rotation, and Gmail.
5. **Advanced** — destructive score controls and deployment/legacy worker status.

Use category cards on wider screens and a compact category selector on phones. Reflect
the selected category in the URL hash so links such as `/settings#ai` are stable without
persisting presentation state in the database. Keep unsaved Settings state in the parent
page while switching categories, and keep the global Save settings action visible.
Connection, API-key, rotation, and Gmail actions continue to save immediately.

Every category and non-obvious field receives a plain-language explanation of its runtime
effect and cost/safety implications. Do not expose a control as functional when it is not:
the unused `schedule_time` database field remains for compatibility but is no longer shown.
The Automation page states that Netlify owns the discovery timer and that the account
switch only opts the account into or out of that scheduled invocation.

## Consequences

- Users see a short, task-focused page instead of an unrelated sequence of every setting.
- Mobile users always see the current category rather than an off-screen horizontal tab.
- No API, database, RLS, credential, or worker trust boundary changes. Existing saved
  values and update behavior remain compatible.
- A future user-configurable discovery time requires a scheduler/runtime design; merely
  restoring the unused input would not implement that behavior.

## Verification

- TypeScript, app tests, production build, and documentation checks.
- Authenticated desktop and mobile visual smoke checks across multiple categories.
