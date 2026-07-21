# ADR 0109: Public Funnel health and onboarding failure state

- Status: accepted
- Date: 2026-07-21
- Amends: ADRs 0088 and 0089 operational verification

## Context

The production gateway and worker were healthy on the server and reachable over the
tailnet, while every Netlify server-side backend request failed. The server watchdog used
the same `*.ts.net` hostname as Netlify, but Tailscale split DNS resolved it privately to
the machine's `100.x` address. Its health request therefore bypassed the public Funnel
relay and falsely reported success while the internet-facing TLS connection failed.

Login always routes through `/onboarding`. That page rendered its résumé upload form
while account status was still loading and also when `/api/onboarding` failed. A returning
`vamsi` session was consequently shown a new-account upload prompt even though the
correct forced-RLS profile, Base résumé, and `onboarding_complete=true` row remained intact.

## Decision

- Verify public Funnel health by resolving the Funnel hostname through an external DNS
  resolver and connecting to those public addresses with the original TLS hostname.
- Use that check in each instance watchdog. When unhealthy, reassert only the instance's
  configured `APP_PATH` mapping; never reset Funnel or modify another application's path.
- Add a forced-command `repair-funnel` operation for the explicitly selected production
  or development instance. It cycles and reasserts only that instance path, never the
  shared HTTPS listener, and must pass the public-relay check before reporting success.
- If bounded path repair fails and the relay itself is unavailable, permit one
  production-only forced command to schedule Tailscale's documented down/up reconnect.
  Persistent background Funnel mappings resume automatically; the operation never resets
  Funnel configuration or rewrites the reserved root and unrelated paths.
- Keep onboarding loading, unavailable, incomplete, and complete states distinct. Never
  show upload until a successful account-status response proves onboarding is incomplete.
  On failure, explain that existing data is unchanged and provide a retry action.
- Redirect returning completed accounts from onboarding to Dashboard. Newly completed
  onboarding retains its existing confirmation controls.

## Consequences

- A healthy private gateway can no longer mask a broken public path used by Netlify.
- The restricted key gains one operational repair but no shell, forwarding, global Funnel
  reset, arbitrary path, or cross-instance authority. Relay recovery briefly interrupts
  tailnet connectivity, so it is used only after path-scoped repair proves insufficient.
- Backend outages no longer look like account deletion or invite destructive re-onboarding.
- Public DNS is an additional watchdog dependency; resolution failure conservatively
  triggers an idempotent reassertion of only the current instance path.

## Verification

- Unit-contract test the bounded remote command, protected path interpolation, external
  DNS lookup, and `curl --resolve` relay check.
- Test onboarding loading/error rendering and completed-account Dashboard routing.
- Prove a private health request can succeed while the public checker fails, repair both
  Funnel paths, then confirm Netlify's authenticated onboarding API returns the persisted
  completed account instead of HTTP 500.
