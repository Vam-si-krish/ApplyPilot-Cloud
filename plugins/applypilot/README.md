# ApplyPilot Codex plugin

This plugin replaces the repeated batch-prompt handoff with six structured MCP tools and a bundled Chrome workflow skill. Its installed configuration connects to the production ApplyPilot site by default.

## Install from this checkout

```bash
codex plugin marketplace add /absolute/path/to/ApplyPilot-Cloud-dev
codex plugin add applypilot@personal
```

Confirm `applypilot@personal` is `installed, enabled` with `codex plugin list`. After
installing or updating, start a new Codex thread so the bundled skill and MCP tools are
loaded.

Development testing may explicitly override `APPLYPILOT_URL` with
`https://applydev.vamsikrish.com`; the packaged/default endpoint remains
`https://apply.vamsikrish.com` so production pairing codes reach the database that
created them.

No environment values or access tokens need to be copied. In ApplyPilot, open **AI Apply**, choose **Pair Codex**, and give the displayed one-time code to Codex. Codex calls `connect_applypilot`; the code is consumed and the resulting token remains only in the MCP process memory.

The connection lasts two hours, belongs to one ApplyPilot user, and can be disconnected from the tab. It can only list active AI-queue jobs, read the candidate/application context for one active queue item, and record start, Needs review, or a visibly confirmed Applied outcome. Applied covers both a submission completed now and an employer site saying the user already applied. It cannot access API keys, settings, other users, or general database tables.

During development, validate the MCP handshake from this directory:

```bash
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"1"}}}' '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' | node scripts/applypilot-mcp.mjs
```
