# Development and documentation protocol

The repository uses a risk-proportionate loop:

```text
classify → orient only as needed → implement → targeted verify → document impact → commit/deploy
```

## Change classes and gates

| Class | Typical work | Required final gates |
|---|---|---|
| Review | Explanation, diagnosis, status | None; remain read-only |
| Tiny | Copy/style/comment/docs with no behavior or contract change | Directly relevant check; `npm run docs:check` for Markdown |
| Standard | Product behavior, app logic, API contract, reusable UI | Relevant tests, `npm run typecheck`, `npm run build`, `npm run docs:check` |
| High-risk | Auth/RLS, ownership, secrets, migration/storage, worker/external boundary, deployment | Standard gates plus affected backend/worker/migration/isolation/health checks |

During implementation, run the narrowest useful test. Run each applicable final gate once
before commit. A final documentation-only correction requires `docs:check`, not another
full application suite or build.

Available gates:

```bash
npm run test
npm test --prefix backend
npm test --prefix resume-worker
npm run typecheck
npm run build
npm run docs:check
```

`npm run lint` is not configured; do not accept its interactive setup prompt.

## Task-scoped orientation

For Standard and High-risk work:

1. Check branch, working tree, and recent history.
2. Read the orientation and module map in `CLAUDE.md` plus the latest devlog.
3. Locate only the affected PRD/Architecture headings with `rg`, then read those sections.
4. Use `docs/DECISIONS.md` to route to the current ADRs for the affected surface.
5. Identify data owner, caller, trust boundary, long-running/serverless owner, secrets,
   and deployment target. High-risk changes must state these explicitly in the devlog.

Do not load complete living documents or the entire ADR directory unless the requested
change genuinely spans them.

## Documentation impact

| Impact | Update |
|---|---|
| Product behavior, scope, phase, acceptance rule | `docs/PRD.md` |
| Component, data flow, trust boundary, persistence, deployment, ownership | `docs/ARCHITECTURE.md` |
| Durable choice, exception, reversal, or meaningful trade-off | new/amended ADR and `docs/DECISIONS.md` |
| Setup, environment, operator action, public endpoint | README/runbook and `.env.example` as applicable |
| Deferred/completed roadmap item or changed risk | `docs/BACKLOG.md` |
| Standard or High-risk implemented slice | latest `docs/devlog/DAY-N.md` |

Review and Tiny tasks do not require a devlog unless they reveal a durable decision or
material operational fact. Historical ADRs/devlogs are evidence: amend or supersede them;
do not rewrite their original context. Living documents must describe current reality.

Record implementation and pre-deployment verification before committing. Git history,
the deploy command, and the final user handoff record a routine successful deployment;
avoid a second documentation-only commit. If deployment exposes a failure, risk, or new
decision, document that material result in the next implementation commit.

## Branch and deployment path

- Feature work: `develop` worktree, isolated development database/services, and
  `./scripts/jobpilot-dev-server`.
- Production: `multi-user-fork` and `./scripts/jobpilot-server`, only after explicit user
  approval and development acceptance.
- Never copy development data into production or point development at production secrets.
- Use the guarded CLI for sync, status, bounded logs, restart, and backup. Never edit the
  live server checkout.

The push is the Netlify handoff. Netlify commonly takes about five minutes; once code,
tests, build, push, and affected backend sync are healthy, hand control back to the user
for frontend acceptance instead of repeatedly polling an expected build window.

## Definition of done

A change is complete when applicable gates pass, living docs do not contradict the
implementation, Standard/High-risk work has a concise devlog entry, the commit is pushed
when requested, and affected services are verified in proportion to risk.
