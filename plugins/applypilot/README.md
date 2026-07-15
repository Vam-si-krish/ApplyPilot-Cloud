# ApplyPilot Codex plugin

This development plugin replaces the repeated batch-prompt handoff with five structured MCP tools and a bundled Chrome workflow skill.

## Install from this development checkout

```bash
codex plugin marketplace add /absolute/path/to/ApplyPilot-Cloud-dev
codex plugin add applypilot@personal
```

Confirm `applypilot@personal` is `installed, enabled` with `codex plugin list`. After
installing or updating, start a new Codex thread so the bundled skill and MCP tools are
loaded.

The MCP process needs two local environment variables:

```bash
export APPLYPILOT_URL="https://your-development-site.example"
export APPLYPILOT_AI_TOKEN="<short-lived token created while signed into ApplyPilot>"
```

For Codex CLI, export them in the same terminal before starting `codex`. A running Codex
desktop process will not see environment changes until it is fully quit and reopened.

The token lasts two hours, belongs to one ApplyPilot user, and can be revoked. It can only list active AI-queue jobs, read the candidate/application context for one active queue item, and record start, Needs review, or confirmed submission. It cannot access API keys, settings, other users, or general database tables.

During development, validate the MCP handshake from this directory:

```bash
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"1"}}}' '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' | node scripts/applypilot-mcp.mjs
```
