# Repository working agreement

These instructions apply to every development session in this repository.

## Before changing code

1. Read `CLAUDE.md`, the latest file in `docs/devlog/`, and the relevant part of
   `docs/PRD.md`.
2. Read `docs/ARCHITECTURE.md` before any non-trivial change. Identify the trust
   boundary, data owner, deployment process, and long-running/serverless boundary
   affected by the change.
3. Read the relevant accepted ADRs. If the requested behavior conflicts with an
   accepted decision, write a superseding/amending ADR before implementing it.
4. Check `git status` and `git log`; preserve unrelated user work.

## While developing

- Keep the implementation inside the documented module boundaries. If reality
  requires a different boundary, update Architecture and record the decision.
- Treat `multi-user-fork` as a private multi-user product: preserve forced RLS,
  UUID-scoped files/worker calls, deployment-managed infrastructure, and the
  separation from ApplyPilot production.
- Add regression coverage for changed behavior, especially authentication,
  ownership, worker routing, scoring, and external request boundaries.

## Before declaring work complete

Follow `docs/DEVELOPMENT.md` and perform a documentation-impact review:

- update `docs/ARCHITECTURE.md` when components, data flow, trust boundaries,
  deployment topology, or module ownership changed;
- update `docs/PRD.md` when product behavior, scope, phase, or acceptance criteria changed;
- add or amend an ADR for a durable decision or reversal;
- update README/runbooks/env examples when setup or operations changed;
- update `docs/BACKLOG.md` when a risk or deferred task changed;
- always append the implementation and verification result to the latest devlog
  (create the next `DAY-N.md` when appropriate).

Run `npm run docs:check`, relevant tests, `npm run typecheck`, and `npm run build`.
Documentation is part of the definition of done; do not leave current-state docs
describing superseded behavior. Preserve historical ADRs/devlogs and point to the
superseding decision instead of rewriting history.
