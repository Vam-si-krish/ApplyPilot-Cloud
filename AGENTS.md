# Repository working agreement

Use the smallest safe workflow for the requested change. Feature work defaults to the
`develop` worktree and isolated development services. Change `multi-user-fork` or deploy
production only when the user explicitly asks.

## Classify first

- **Review:** read-only explanation, diagnosis, or status. Inspect only what is relevant;
  do not edit, test, build, deploy, or update documentation.
- **Tiny:** copy, styling, comments, or documentation with no behavior, contract, data,
  or operational change. Check `git status` and the touched files; run only a directly
  relevant check (`npm run docs:check` for docs). No devlog or full build by default.
- **Standard:** product behavior, application logic, API contracts, or reusable UI.
  Follow the task-scoped orientation, tests, documentation-impact review, and devlog
  requirements in `docs/DEVELOPMENT.md`.
- **High-risk:** authentication, authorization/RLS, user ownership, secrets, migrations,
  storage, worker routing, external/billable requests, deployment, backup, or production
  isolation. Use the Standard workflow plus the relevant backend/worker, migration,
  isolation, operational, and live health checks.

Escalate when uncertain. A small diff touching a high-risk boundary remains High-risk.

## Task-scoped orientation

1. Check `git status`, branch, and recent `git log`; preserve unrelated user work.
2. For Standard/High-risk work, read the orientation and module map in `CLAUDE.md`, the
   latest devlog, and only the relevant PRD/Architecture sections.
3. Use `docs/DECISIONS.md` to find relevant accepted ADRs; do not scan every ADR. If the
   request conflicts with one, add an amending/superseding ADR before implementation.

## Non-negotiable boundaries

- Preserve forced RLS, UUID-scoped files and worker calls, deployment-managed
  infrastructure, and complete separation from ApplyPilot production.
- Keep changes inside documented module boundaries or update Architecture and record the
  new boundary.
- Validate external inputs and add regression coverage proportionate to the risk.

## Completion

Follow the gate matrix and documentation-impact matrix in `docs/DEVELOPMENT.md`. Run
targeted checks while iterating and each applicable final gate once. Do not rerun full
suites after a docs-only final edit.

Record pre-deployment implementation and verification in the devlog for Standard and
High-risk slices. Report deployment results in the final handoff; do not create a second
docs-only commit solely to record a successful deployment. Update a later devlog only
when deployment reveals a material issue, decision, or operational lesson.
