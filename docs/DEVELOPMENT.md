# Development and documentation protocol

This is the required loop for human and AI-assisted changes:

```text
orient → architecture check → decision/spec → implement → verify → document → commit/deploy
```

## 1. Orient

- Confirm the branch and working tree with `git status`; read recent `git log`.
- Read the latest `docs/devlog/DAY-*.md` and the relevant PRD section.
- For any change beyond a tiny copy/style fix, read the relevant Architecture
  sections and ADRs before editing code.

## 2. Architecture check

Write down, at least mentally, the affected boundaries:

- Who owns the data? Which `user_id` and storage namespace must apply?
- Is the caller a browser, Netlify route, cron/webhook, gateway, or worker?
- Does the work fit a serverless request, or must it run on the always-on worker?
- Is the target endpoint deployment-managed or user-configurable?
- Which secret is used, and can it reach the browser or another account?
- Does the change preserve the separate `jobpilot_multi` database, file tree,
  ports, Funnel path, and services?

If the implementation would contradict an accepted ADR, stop and add an ADR that
amends or supersedes it. Do not silently let code and architecture diverge.

## 3. Implement and verify

Validate external inputs and add proportionate regression coverage. Use the gates
that apply:

```bash
npm run docs:check
npm run test
npm test --prefix backend
npm test --prefix resume-worker
npm run typecheck
npm run build
```

Also run syntax checks, migration/fresh-database tests, live isolation probes,
worker health checks, or backup/restore checks when those surfaces changed.
`npm run lint` is not currently a gate because this repository has no committed
ESLint configuration; do not accept the interactive setup prompt during automation.

### Personal-laptop deploy loop

After the one-time restricted-key/bootstrap steps in the
[backend runbook](../backend/README.md#personal-laptop-development-and-operations), normal
development does not require opening or screen-sharing the server laptop:

```bash
npm run test && npm test --prefix backend && npm test --prefix resume-worker
npm run typecheck && npm run docs:check && npm run build
git add <files> && git commit
./scripts/jobpilot-server deploy
```

Feature work uses a separate `develop` worktree and isolated backend:

```bash
git -C <production-clone> worktree add ../ApplyPilot-Cloud-dev develop
cd ../ApplyPilot-Cloud-dev
./scripts/jobpilot-dev-server bootstrap
./scripts/jobpilot-dev-server deploy
```

After development end-to-end checks pass, merge `develop` into `multi-user-fork`, rerun
the gates, and deploy with `scripts/jobpilot-server`. Never copy development data into
production or point a feature branch at production secrets.

The deploy command requires a clean `multi-user-fork`, pushes it, requests the server's
allowlisted fast-forward path, and waits for `/worker/version` to report the commit. The
push is also the Netlify frontend handoff. Use `status`, bounded `logs`, or a targeted
`restart` through the same CLI; do not edit the live server checkout.

## 4. Documentation impact review

Every development session must explicitly consider each living document:

| Change | Required documentation |
|---|---|
| Product scope, phase, user behavior, acceptance rule | `docs/PRD.md` |
| Component, data flow, trust boundary, persistence, deployment, module owner | `docs/ARCHITECTURE.md` |
| Durable choice, trade-off, exception, or reversal | new/amended `docs/adr/NNNN-*.md` |
| Setup, environment variable, operator action, public endpoint | README/runbook and `.env.example` |
| Deferred risk, follow-up, or completed roadmap item | `docs/BACKLOG.md` |
| Any implemented slice | latest `docs/devlog/DAY-N.md` |

Historical ADRs and old devlogs are evidence, not living specifications. Do not
rewrite their original context; add a clear amendment/superseding link. Living docs
(`CLAUDE.md`, PRD, Architecture, README, Backlog, runbooks) must describe current reality.

## 5. Definition of done

A change is complete only when:

1. code and tests pass the relevant gates;
2. current Architecture and PRD do not contradict the implementation;
3. the devlog records what changed and how it was verified;
4. operational instructions and environment examples are usable;
5. the commit is pushed and affected server services are restarted/verified when needed.
