# ADR 0093: Supervised external-application handoff

- Status: accepted
- Date: 2026-07-15
- Amends: original no-auto-apply non-goal; ADR 0061 application parking

## Context

Tailor & Apply already prepares a truthful tailored résumé, a PDF, an optional cover
letter, and an external posting link. The owner wants an AI to handle simple application
forms from start to finish, continue past problem applications, and submit quickly under
supervision. The application currently has no durable assignment lifecycle, browser
handoff contract, or distinction between an unfinished form and a verified submission.

Direct browser automation is a separate, higher-risk boundary. Forms can request
sensitive or unknown facts, page content can contain hostile instructions, authentication
and CAPTCHAs require the user, and a Submit click is a consequential external action.
LinkedIn also remains outside the authorized automation scope.

## Decision

- Add a separate **Assign to AI** view inside Tailor & Apply. AI state is orthogonal to
  tailoring state and remains in the existing forced-RLS `applications` row.
- Accept only explicitly External Apply jobs with a valid non-LinkedIn HTTP(S) target,
  `status=ready`, a tailored résumé, and a rendered PDF.
- Limit the active supervised queue to five applications.
- Persist the guarded lifecycle `assigned → in_progress → ready_to_submit → submitted`.
  A problem instead transitions an active row to `blocked`, records a concise reason,
  and parks it in Set Aside. Retry is explicit.
- Use a dedicated lifecycle API. The generic application PATCH endpoint does not accept
  AI fields. Recording `submitted` requires a reviewed state plus `confirmed: true`, and
  synchronizes the application and job applied timestamps.
- Phase 1 supplies a copyable prompt for a user-invoked Chrome workflow. Starting a row
  opens the external posting and downloads its exact tailored files. The agent must use
  verified facts, never invent sensitive answers, leave blocked tabs open, continue to
  the next row, and ask for confirmation immediately before Submit. It records Submitted
  only after the site displays visible success.
- Phase 1 does not start or silently control a browser, store page contents or browser
  credentials, bypass security controls, or automate LinkedIn/Easy Apply.

## Consequences

- The product gains a safe, inspectable orchestration layer now without pretending the
  actual browser executor already exists.
- Blocked forms stop holding up the batch and remain recoverable with their reason.
- The user retains authority at the consequential action while routine form completion
  can become faster in a later browser-control phase.
- A future executor must use this lifecycle rather than creating a parallel queue. It
  requires its own reviewed design for site support, field provenance, prompt-injection
  handling, authentication, audit evidence, and success detection.

## Verification

- Unit-test external readiness, LinkedIn/Easy Apply rejection, transition guards,
  blocker normalization, queue bounding, and prompt content.
- Verify the route requires submission confirmation and keeps persistence in the
  existing RLS-owned table.
- Run app tests, TypeScript, production build, documentation validation, backend tests,
  and development deployment/migration smoke checks.
