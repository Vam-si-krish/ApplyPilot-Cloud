# ADR 0116: Provider-aware mail-sync chunks

- Status: accepted
- Date: 2026-07-31
- Amends: ADR 0013 two-phase Gmail sync

## Context

ADR 0013 sends eight pending messages through one classification request. Direct API
providers finish that chunk within the hosting limit, but a ChatGPT or Claude
subscription completion crosses the server-laptop worker and may take several seconds.
Eight sequential worker calls can outlive the serverless request. A live production
failure classified only part of an eleven-message backlog, left seven rows pending, and
still showed “Done — classified 11” because the Inbox client treated the failed request
as a completed loop.

## Decision

- Resolve the complete Everything else provider/model pair before selecting a mail
  classification batch.
- Keep the existing eight-message batch for direct API providers.
- Limit Claude and ChatGPT subscription providers to one message per classification
  request. The browser and headless orchestrator continue the existing idempotent pending
  loop across requests.
- Treat HTTP failures and non-JSON hosting errors as interrupted progress. Inbox shows
  how many messages remain and never reports success unless the returned remaining count
  reaches zero.

The mail prompt, one-call-per-message contract, Gmail OAuth scope, transient body
handling, stored classification fields, and forced-RLS owner boundary do not change.

## Consequences

Subscription sync uses more small HTTP requests, but each request fits the hosting
boundary and returns an observable progress tick. Direct API sync retains its existing
throughput. A transient failure remains safely retryable because only pending rows are
selected and each successfully classified row is persisted before the next request.

## Verification

Pin provider-aware batch selection for both subscription provider IDs, direct API
providers, and incomplete-lane fallback. Run the mail/parser and lane-routing tests,
application gates, backend/worker isolation checks, production deployment health, and a
live Inbox drain using the connected ChatGPT subscription.
