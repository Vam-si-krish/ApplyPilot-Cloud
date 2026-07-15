# ADR 0098: Development plugin marketplace and live MCP smoke

- Status: accepted
- Date: 2026-07-15
- Amends: ADR 0096

## Context

ADR 0096 deliberately stopped before marketplace creation or plugin installation. After
the foundation was committed and pushed, the development server applied migration 0051
and Netlify exposed the AI-agent routes. The remaining requirement was to make the plugin
discoverable by Codex and prove that the installed MCP server could authenticate against
the real development site.

## Decision

- Add a repo-local marketplace at `.agents/plugins/marketplace.json` named `personal`,
  with `applypilot` available and authentication requested on install.
- Register the development checkout as a local Codex marketplace and install
  `applypilot@personal`. The marketplace source continues to point at the reviewed
  `plugins/applypilot` directory rather than creating a divergent copy.
- Keep the temporary two-hour environment-token setup for this development phase. A
  running desktop process must be fully restarted after its environment changes; OAuth or
  device authorization remains Phase 2 of the long-term plan.
- Verify the deployed `ai_agent_runs` table and both Netlify AI-agent route families,
  then create a dedicated temporary run, initialize the installed stdio MCP server, list
  all five tools, perform a live user-scoped queue read, and revoke that run immediately.
- Do not install or package the plugin for the production branch in this step.

## Consequences

- A new Codex thread can discover the Apply jobs skill and tools from the local
  development marketplace.
- Development now has a tested path from Codex MCP → Netlify AI-agent route → UUID-scoped
  gateway/PostgREST data. The smoke test observed four assigned rows without modifying
  their lifecycle.
- Token setup remains the principal usability gap; expiry and revocation continue to
  limit exposure while OAuth/device authorization is developed.

## Verification

- `codex plugin list` reports `applypilot@personal` as installed and enabled.
- Plugin validation passes at version `0.1.0`.
- Development backend/server and `origin/develop` report commit `0030b62`; migration 0051
  is queryable and unauthenticated AI-agent API requests fail with the expected 401.
- The authenticated live MCP smoke reports the expected server name, five tools, and a
  successful queue result; its temporary run is revoked afterward.
