# ADR 0096: ApplyPilot plugin and MCP foundation

- Status: accepted
- Date: 2026-07-15
- Extends: ADRs 0093–0095

## Context

The copied Chrome batch prompt proved the end-to-end workflow, but it duplicates queue
state in prose, is bounded to twenty rows per handoff, and makes Codex depend on the page
layout to recover application IDs and outcomes. A long-term workflow should read the live
queue and write its lifecycle through structured tools while preserving the existing
forced-RLS, per-user trust boundary. It must not give a local agent the backend service
key, database password, or reusable webpage session.

## Decision

- Add a repo-local Codex plugin at `plugins/applypilot/`, scaffolded with the standard
  plugin manifest. It bundles an `apply-jobs` skill and a dependency-free local stdio MCP
  server; it does not yet add a marketplace entry or install itself.
- Expose exactly five tools: list assigned jobs, get one active application's grounded
  context, start an application, mark Needs review, and mark visibly confirmed
  submission. Assignment, unassignment, retry, settings, credentials, and general data
  access stay in the webpage.
- A signed-in webpage session may create a two-hour AI agent run. Its bearer token carries
  purpose-bound signed `userId`, `runId`, and expiry claims. The database stores only the
  matching revocable run record, not the raw token.
- MCP API routes validate the signature, expiry, and unrevoked run, then re-enter the
  gateway with `supabaseAdmin(userId)`. Forced RLS remains the final ownership boundary.
  Only `/api/ai-agent/mcp/*` bypasses cookie middleware; run creation/revocation remains
  session-gated.
- `@Chrome` remains the browser executor and uses the user's existing browser profile and
  autofill extension. Candidate context is requested only if autofill misses a field.
  Unknown required facts become Needs review; submission is recorded only after visible
  employer-site success.
- Keep the copied next-twenty prompt as a temporary fallback. The UI can mint the short
  run and copy the two local environment exports needed by the development MCP process.

## Consequences

- Queue order and status remain live instead of being copied into a large prompt.
- The bearer token is sensitive for at most two hours and can be revoked, but the initial
  development setup still requires one terminal paste. OAuth/device authorization is the
  next improvement before broad installation.
- The MCP server has no npm runtime dependencies and can be validated with a JSON-RPC
  handshake. Browser automation remains observable in the user's Chrome session.
- Adding run leases, detailed step evidence, idempotency keys, installation/marketplace
  packaging, and evaluated site behavior is deferred to the phased plan.

## Verification

- Unit-test token purpose, tamper rejection, and expiry.
- Contract-test forced RLS, UUID-scoped MCP routes, restricted lifecycle actions, and all
  five advertised MCP tools.
- Validate the plugin manifest, smoke-test the stdio handshake, and run application tests,
  TypeScript, docs validation, and the production build before review.
