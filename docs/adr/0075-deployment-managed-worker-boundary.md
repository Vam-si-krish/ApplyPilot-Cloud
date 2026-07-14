# ADR 0075: Deployment-managed worker boundary

- Status: accepted
- Date: 2026-07-14
- Builds on: ADRs 0072–0074

## Context

The inherited single-owner application stored a résumé-worker URL and secret in the
settings row so the owner could update an external tunnel. In the managed multi-user
fork, every authenticated user has a settings row. Reusing that override would let a
user choose the destination of privileged server-side requests, expose a deployment
secret through Settings, and contradict the fixed Netlify → gateway → isolated worker
topology.

## Decision

When `BACKEND_URL` is configured, the application is a managed fork deployment:

- worker calls resolve only `RESUME_WORKER_URL` and `RESUME_WORKER_SECRET` from the
  server environment and fail closed if either is absent;
- Settings neither returns those values nor accepts changes to them;
- the UI hides the legacy worker-connection controls; and
- every worker-calling route uses the centralized resolver in `lib/workerConfig.ts`.

Deployments without `BACKEND_URL` retain the settings override for compatibility with
the original single-owner topology.

## Consequences

- An authenticated fork user cannot redirect worker traffic to an arbitrary host or
  read/replace the shared worker credential.
- Changing the managed worker endpoint is an operator deployment action and requires an
  environment update/redeploy, which matches the documented architecture.
- Unit tests pin managed precedence, fail-closed behavior, and legacy compatibility.
