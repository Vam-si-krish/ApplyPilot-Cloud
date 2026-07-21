# Day 45 — Public Funnel recovery and safe onboarding failure state

**Date:** 2026-07-21
**Branch:** `develop` → `multi-user-fork`

## Incident

- The owner reported that the app first appeared unavailable and then showed the `vamsi`
  account a résumé-upload onboarding form after a fresh login.
- Both local services were healthy. Direct RLS-scoped reads proved the production and
  development `vamsi` accounts retained the expected UUID, completed-onboarding flag,
  profile row, and structured Base résumé.
- A real deployed login succeeded, but Netlify's authenticated `/api/onboarding` returned
  `500 TypeError: fetch failed`. Forced public-relay checks failed while tailnet requests
  succeeded, proving the Funnel exposure—not user data—was the incident boundary.

## Implementation

- Synchronized `develop` to the latest production commit before editing.
- Added an external-DNS/TLS-preserving Funnel health checker and replaced the watchdog's
  misleading private health probe.
- Added a restricted, environment-selected `repair-funnel` command that can reassert only
  `/jobpilot` or `/jobpilot-dev` from protected configuration. After a plain reassertion
  did not refresh the public relay, the repair was tightened to cycle only the selected
  path before reasserting it; the shared listener and unrelated routes remain untouched.
- Because path cycling still left the relay unable to complete TLS, added a final
  production-only scheduled Tailscale reconnect following official recovery guidance.
  Background Funnel configuration is preserved; no shared route is reset or rewritten.
- The first scheduled reconnect was safely rejected by Tailscale because its SSH-loss
  acknowledgement was absent; logs proved no change occurred. Added the explicit
  `--accept-risk=lose-ssh` acknowledgement required for this intentional recovery.
- Made onboarding render an explicit loading state, a non-destructive connection-error
  state with retry, and direct Dashboard routing for existing completed accounts.
- Recorded the operational amendment in ADR 0109 and updated architecture, requirements,
  decision routing, and the backend runbook.

## Verification

- Full local gates pass: 263 application tests with 16 credentialed evaluations skipped,
  21 backend tests, 21 worker tests, TypeScript, shell syntax, documentation validation
  across 169 Markdown files and 103 ADRs, and the 35-page production build.
- Both environment deployments, public Funnel recovery, and authenticated Netlify smoke
  results follow below.
